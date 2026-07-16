// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createAboutButton } from './about';
import { EVENT_LEGEND } from './historyBar';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createAboutButton (v0.96.0 — Keys + version folded in)', () => {
  it('the title is ONE button carrying name + version + byline, and it copy-confirms the line', () => {
    createAboutButton('9.9.9');
    const title = document.querySelector<HTMLButtonElement>('.osp-about__titlebtn')!;
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('One Still Point');
    expect(title.textContent).toContain('v9.9.9');
    expect(title.textContent).toContain('created by Chris Portka'); // the byline lives in the button now
    expect(title.getAttribute('data-addr')).toBe('One Still Point v9.9.9 created by Chris Portka');
    // jsdom has no clipboard — the handler falls through to the ✓ flash either way.
    title.click();
    expect(title.classList.contains('is-copied')).toBe(true);
  });

  it('keyboard shortcuts render below the logo, inside the card', () => {
    createAboutButton('1.0.0');
    const card = document.querySelector('.osp-about__card')!;
    const keys = card.querySelector('.osp-about__keys')!;
    expect(keys).not.toBeNull();
    expect(keys.textContent).toContain('Key Shortcuts');
    expect(keys.querySelectorAll('kbd').length).toBeGreaterThan(5); // Esc ? Space ← → ↑ ↓ R F…
    // …and the logo sits before the shortcuts in document order.
    const logo = card.querySelector('.osp-about__logo')!;
    expect(logo.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the timeline-event colour key renders with the SHORT names', () => {
    createAboutButton('1.0.0');
    const keys = document.querySelector('.osp-about__keys')!;
    expect(keys.textContent).toContain('Timeline events');
    for (const [, label] of EVENT_LEGEND) expect(keys.textContent).toContain(label);
    expect(keys.textContent).not.toContain('Collapsed into a black hole'); // the long names are gone
    expect(keys.querySelectorAll('.osp-keys__sw')).toHaveLength(EVENT_LEGEND.length);
  });

  it('nothing already in About was lost: byline, logo, Github link, donate chips', () => {
    createAboutButton('1.0.0');
    const card = document.querySelector('.osp-about__card')!;
    expect(card.querySelector('.osp-about__byline')!.textContent).toContain('Chris Portka');
    expect(card.querySelector('.osp-about__logo svg')).not.toBeNull();
    expect(card.querySelector('a[href*="github.com"]')).not.toBeNull();
    expect(card.querySelectorAll('.osp-about__chip').length).toBeGreaterThanOrEqual(3); // BTC · ETH · Venmo
  });

  it('the overlay still toggles (Esc/? route here now)', () => {
    const about = createAboutButton('1.0.0');
    const overlay = document.querySelector<HTMLElement>('.osp-about')!;
    expect(overlay.hidden).toBe(true);
    about.toggle();
    expect(overlay.hidden).toBe(false);
    about.toggle();
    expect(overlay.hidden).toBe(true);
  });
});
