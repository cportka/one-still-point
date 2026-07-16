import { TAGLINE } from '../tagline';
import { EVENT_COLOR, EVENT_LEGEND } from './historyBar';

/** The keyboard shortcuts, rendered inside the About card (v0.96.0 — the separate "Keys"
 *  popover folded in here; ? and Esc both route to this dialog now). Wording is TIGHT
 *  (v0.96.1): one word each where possible — the card was too tall. */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Esc ? /', 'This dialog'],
  ['Space', 'Pause'],
  ['← →', 'Step'],
  ['↑ ↓', 'Speed'],
  ['R', 'Replay'],
  ['F', 'HUD'],
];

const GITHUB = 'https://github.com/cportka/one-still-point';
const VENMO = 'https://venmo.com/portka';
const ETH = '0x354c2aB3f7a23F74cdDC745B26aEA53EC1602203';
const BTC = '3J4XRAwhHwJWQb4F4qw5yTCrs5Zg1s1vaR';

const abbreviate = (addr: string): string => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

// The animated "Infall" monoline mark (2026-07 branding pass v2, roadmap #3): the monoline black
// hole — a bright photon halo hugging the event-horizon sphere, a thin accretion orbit tucking
// behind the halo at the back and riding in front across the body — with stardust motes rising from
// behind the halo, sweeping over the top, and setting behind it. Self-contained (its own
// gradients/blurs/animation); the dust is hidden entirely unless offset-path animation is supported
// AND motion is allowed (the @supports + reduced-motion gate), so it degrades to the still mark.
// Mirrors `assets/hero.svg` (no background tile — the card provides the backdrop).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" role="img" aria-labelledby="osp-at osp-ad">
<title id="osp-at">One Still Point — Infall, animated mark</title>
<desc id="osp-ad">The monoline black hole with stardust: motes rise from behind the halo at lower left, sweep over the top, and set behind the opaque halo surface on the right side of the body.</desc>
<defs>
<radialGradient id="a-glow" cx="50%" cy="50%" r="50%">
<stop offset="0" stop-color="#aca496" stop-opacity=".14"></stop>
<stop offset=".38" stop-color="#aca496" stop-opacity=".05"></stop>
<stop offset=".66" stop-color="#aca496" stop-opacity="0"></stop>
</radialGradient>
<radialGradient id="a-body" cx="50%" cy="38%" r="62%">
<stop offset="0" stop-color="#171717"></stop>
<stop offset="1" stop-color="#000000"></stop>
</radialGradient>
<radialGradient id="a-ringmask" cx="320" cy="320" r="320" gradientUnits="userSpaceOnUse">
<stop offset=".40" stop-color="#000"></stop>
<stop offset=".44" stop-color="#fff"></stop>
</radialGradient>
<linearGradient id="a-bulgefade" x1="0" y1="0" x2="640" y2="0" gradientUnits="userSpaceOnUse">
<stop offset=".23" stop-color="#000"></stop><stop offset=".35" stop-color="#fff"></stop>
<stop offset=".65" stop-color="#fff"></stop><stop offset=".77" stop-color="#000"></stop>
</linearGradient>
<filter id="a-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.2"></feGaussianBlur></filter>
<filter id="a-aura" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"></feGaussianBlur></filter>
<filter id="a-fade" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4.5"></feGaussianBlur></filter>
<radialGradient id="a-mote" cx="50%" cy="50%" r="50%">
<stop offset="0" stop-color="#e9e3d5" stop-opacity="1"></stop>
<stop offset=".42" stop-color="#e9e3d5" stop-opacity="1"></stop>
<stop offset=".62" stop-color="#e9e3d5" stop-opacity=".38"></stop>
<stop offset="1" stop-color="#e9e3d5" stop-opacity="0"></stop>
</radialGradient>
<clipPath id="a-far"><rect x="-80" y="-80" width="800" height="403"></rect></clipPath>
<clipPath id="a-near"><rect x="-80" y="307" width="800" height="413"></rect></clipPath>
<clipPath id="a-disc"><circle cx="320" cy="320" r="128"></circle></clipPath>
<mask id="a-outside" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640"><rect x="0" y="0" width="640" height="640" fill="url(#a-ringmask)"></rect></mask>
<mask id="a-bulge" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640"><rect x="0" y="0" width="640" height="640" fill="url(#a-bulgefade)"></rect></mask>
<style>
.a-m{offset-rotate:0deg;offset-path:path("M238 404C140 300 190 150 320 150C450 150 500 280 430 352")}
@supports (offset-distance:0%){
@media (prefers-reduced-motion:no-preference){
.a-dust{visibility:visible}
.a-m{animation:a-fall 9.6s linear infinite}
.a-m.a-d2{animation-delay:-3.2s}
.a-m.a-d3{animation-delay:-6.4s}
}
}
@keyframes a-fall{from{offset-distance:0%}to{offset-distance:100%}}
</style>
</defs>
<circle cx="320" cy="320" r="371" fill="url(#a-glow)"></circle>
<g mask="url(#a-outside)">
<g transform="rotate(-9 320 320)" clip-path="url(#a-far)">
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#c4beb2" stroke-width="24" opacity=".2" filter="url(#a-aura)"></ellipse>
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#c4beb2" stroke-width="7" filter="url(#a-soft)"></ellipse>
</g>
</g>
<g class="a-dust" visibility="hidden">
<circle class="a-m" r="16.5" fill="url(#a-mote)"></circle>
<circle class="a-m a-d2" r="12.5" fill="url(#a-mote)"></circle>
<circle class="a-m a-d3" r="9.5" fill="url(#a-mote)"></circle>
</g>
<circle cx="320" cy="320" r="128" fill="#000000"></circle>
<circle cx="320" cy="320" r="116" fill="none" stroke="#d8d1c4" stroke-width="13" opacity=".3" filter="url(#a-aura)" clip-path="url(#a-disc)"></circle>
<circle cx="320" cy="320" r="109" fill="url(#a-body)"></circle>
<circle cx="320" cy="320" r="107.5" fill="none" stroke="#ffffff" stroke-opacity=".15" stroke-width="3"></circle>
<circle cx="320" cy="320" r="123.5" fill="none" stroke="#d8d1c4" stroke-width="26" opacity=".26" filter="url(#a-aura)"></circle>
<circle cx="320" cy="320" r="123.5" fill="none" stroke="#d8d1c4" stroke-width="9" filter="url(#a-soft)"></circle>
<g clip-path="url(#a-disc)">
<g transform="rotate(-9 320 320)" clip-path="url(#a-near)">
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#000000" stroke-width="17" opacity=".78" filter="url(#a-fade)"></ellipse>
</g>
</g>
<g transform="rotate(-9 320 320)" clip-path="url(#a-near)">
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#c4beb2" stroke-width="20" opacity=".2" filter="url(#a-aura)"></ellipse>
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#c4beb2" stroke-width="7" filter="url(#a-soft)"></ellipse>
<ellipse cx="320" cy="320" rx="294.5" ry="71" fill="none" stroke="#c4beb2" stroke-width="7.5" filter="url(#a-soft)" mask="url(#a-bulge)"></ellipse>
</g>
</svg>`;

/**
 * The "About" button. Clicking it opens a small modal crediting the author, with the
 * animated mark, the **keyboard shortcuts + timeline-event colour key** (folded in from the
 * old "Keys" popover, v0.96.0), a link to the project, donation options (Venmo plus ETH/BTC
 * addresses that copy in full on click), and the tagline. The title line carries the app
 * name + version as ONE button that copies "One Still Point v<version>" with a ✓ confirm
 * (folded in from the old version chip).
 *
 * Returns the button plus a `toggle` so the keyboard shortcuts (Esc, ?) can open/close
 * the same dialog.
 */
export function createAboutButton(version: string): { button: HTMLButtonElement; toggle: () => void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-about-btn';
  button.textContent = 'About';
  button.title = 'About One Still Point — credits, shortcuts, version';

  // The tagline frames the dialog: its four parts run along the top, down the
  // right, across the bottom, and up the left.
  const [t0 = '', t1 = '', t2 = '', t3 = ''] = TAGLINE.split(' · ');

  const keyRows = SHORTCUTS.map(
    ([keys, label]) =>
      `<div class="osp-keys__row"><span class="osp-keys__k">${keys
        .split(' ')
        .map((k) => `<kbd>${k}</kbd>`)
        .join(' ')}</span><span class="osp-keys__d">${label}</span></div>`,
  ).join('');
  // Colour key for the history scrub bar's transient-event ticks (palette in historyBar.ts).
  const legendRows = EVENT_LEGEND.map(
    ([type, label]) =>
      `<div class="osp-keys__row"><span class="osp-keys__sw" style="--c:${EVENT_COLOR[type]}"></span>` +
      `<span class="osp-keys__d">${label}</span></div>`,
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'osp-about';
  overlay.hidden = true;
  overlay.setAttribute('data-nosnippet', ''); // UI chrome (now incl. the version) — keep out of search snippets
  overlay.innerHTML = `
    <div class="osp-about__card" role="dialog" aria-modal="true" aria-label="About One Still Point">
      <button class="osp-about__close" type="button" aria-label="Close">×</button>
      <div class="osp-about__edge osp-about__edge--top">${t0}</div>
      <div class="osp-about__edge osp-about__edge--right"><span>${t1}</span></div>
      <div class="osp-about__edge osp-about__edge--bottom">${t2}</div>
      <div class="osp-about__edge osp-about__edge--left"><span>${t3}</span></div>
      <div class="osp-about__inner">
        <button class="osp-about__title osp-about__titlebtn osp-about__copy" type="button"
          data-addr="One Still Point v${version}" title="Copy name + version">
          <span class="osp-about__addr">One Still Point <span class="osp-about__ver">v${version}</span></span><span class="osp-about__copied">✓ copied</span>
        </button>
        <div class="osp-about__by">Created by Chris Portka</div>
        <div class="osp-about__logo">${LOGO_SVG}</div>
        <div class="osp-about__keys">
          <div class="osp-about__keycol"><div class="osp-keys__title">Keyboard shortcuts</div>${keyRows}</div>
          <div class="osp-about__keycol"><div class="osp-keys__title">Timeline events</div>${legendRows}</div>
        </div>
        <a class="osp-about__row" href="${GITHUB}" target="_blank" rel="noopener noreferrer">
          <span>Github</span><span class="osp-about__val">cportka/one-still-point&nbsp;↗</span>
        </a>
        <div class="osp-about__row osp-about__donate">
          <span>Donate</span>
          <span class="osp-about__chips">
            <button class="osp-about__chip osp-about__copy" type="button" data-addr="${BTC}" title="Copy BTC address (${abbreviate(BTC)})">
              <span class="osp-about__addr">$BTC</span><span class="osp-about__copied">✓</span>
            </button>
            <button class="osp-about__chip osp-about__copy" type="button" data-addr="${ETH}" title="Copy ETH address (${abbreviate(ETH)})">
              <span class="osp-about__addr">$ETH</span><span class="osp-about__copied">✓</span>
            </button>
            <a class="osp-about__chip" href="${VENMO}" target="_blank" rel="noopener noreferrer" title="Open Venmo (@portka) in a new tab">Venmo&nbsp;↗</a>
          </span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = (): void => {
    overlay.hidden = true;
  };
  const toggle = (): void => {
    overlay.hidden = !overlay.hidden;
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.hidden = false;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.osp-about__close')?.addEventListener('click', close);

  // ETH / BTC rows copy the full address with the same ✓ confirmation.
  overlay.querySelectorAll('.osp-about__copy').forEach((row) => {
    row.addEventListener('click', () => {
      const addr = row.getAttribute('data-addr') ?? '';
      const flash = (): void => {
        row.classList.add('is-copied');
        window.setTimeout(() => row.classList.remove('is-copied'), 1200);
      };
      const clip = navigator.clipboard;
      if (clip?.writeText && addr) void clip.writeText(addr).then(flash, flash);
      else flash();
    });
  });

  return { button, toggle };
}
