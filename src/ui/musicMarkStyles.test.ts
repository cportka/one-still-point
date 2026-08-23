import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * v1.0.0 shipped the music mark stretched across the whole panel. lil-gui's own stylesheet
 * carries `.lil-gui button { width: 100% }` — specificity (0,1,1) — which beat the bare
 * `.osp-music { width: 32px }` at (0,1,0). The mark then covered the entire title row, so every
 * click on the panel header hit play/pause instead of folding the panel (it could never be
 * expanded), and the glyph sat mid-title instead of at its right edge.
 *
 * jsdom does no layout, so a DOM test cannot catch that. These guards work on the cascade itself.
 */

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** CSS specificity as [ids, classes/attrs/pseudo-classes, elements] for the selectors we use. */
function specificity(selector: string): [number, number, number] {
  const s = selector.trim();
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.match(/(^|[\s>+~])([a-z][\w-]*)/g) ?? []).length;
  return [ids, classes, elements];
}

const beats = (a: [number, number, number], b: [number, number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/** Every `selector { body }` pair in a stylesheet, flattened (good enough for these checks).
 *  Comments are stripped first — the rules below are *documented* with braced CSS snippets in
 *  their comments, and parsing those as real rules silently defeated the guard once already. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

describe('the music mark out-specifies lil-gui’s own button rule', () => {
  const app = read('../style.css');
  const lil = read('../../node_modules/lil-gui/dist/lil-gui.esm.js');

  it('lil-gui still ships the `.lil-gui button { width: 100% }` that caused the bug', () => {
    // If this ever stops being true the guards below are no longer load-bearing — but they also
    // stop being harmful, so the test documents the hazard rather than pinning a version.
    expect(lil).toMatch(/\.lil-gui button \{[^}]*width: 100%/);
  });

  it('the rule sizing the mark beats `.lil-gui button` (0,1,1)', () => {
    const sizing = rules(app).filter((r) => /\.osp-music(?![\w-])/.test(r.selector) && /(^|[;\s])width\s*:/.test(r.body));
    expect(sizing.length).toBeGreaterThan(0);
    for (const rule of sizing) {
      expect(beats(specificity(rule.selector), [0, 1, 1])).toBe(true);
    }
  });

  it('the mark is a fixed 32px box, never a full-width one', () => {
    const sizing = rules(app).find((r) => /\.osp-music(?![\w-])/.test(r.selector) && /(^|[;\s])width\s*:/.test(r.body))!;
    expect(sizing.body).toMatch(/width:\s*32px/);
    expect(sizing.body).not.toMatch(/width:\s*100%/);
    expect(sizing.body).toMatch(/position:\s*absolute/); // out of the panel's flex column
  });

  it('the title keeps a clear lane, out-specifying lil-gui’s `.lil-gui .lil-title` padding', () => {
    const lane = rules(app).find((r) => /\.osp-panel__title/.test(r.selector) && /padding-right/.test(r.body));
    expect(lane).toBeDefined();
    // `.lil-gui .lil-title { padding: 0 var(--padding) }` is (0,2,0) and would reset the lane.
    expect(beats(specificity(lane!.selector), [0, 2, 0])).toBe(true);
  });
});

describe('specificity helper', () => {
  it('scores the selectors this file reasons about', () => {
    expect(specificity('.lil-gui button')).toEqual([0, 1, 1]);
    expect(specificity('.lil-gui button.osp-music')).toEqual([0, 2, 1]);
    expect(specificity('.osp-music')).toEqual([0, 1, 0]);
    expect(specificity('.lil-gui .lil-title.osp-panel__title')).toEqual([0, 3, 0]);
    expect(specificity('#osp-splash.osp-splash--retired')).toEqual([1, 1, 0]);
  });

  it('orders by cascade rank, not by total count', () => {
    expect(beats([0, 2, 1], [0, 1, 1])).toBe(true);
    expect(beats([0, 1, 0], [0, 1, 1])).toBe(false); // the bug: fewer elements loses
    expect(beats([1, 0, 0], [0, 9, 9])).toBe(true);
  });
});
