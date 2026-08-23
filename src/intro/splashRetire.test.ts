// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTRO_DIALS } from './introTimeline';
import { hideSplash, SPLASH_HIDE, SPLASH_RETIRED } from './splashRetire';

function splashEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'osp-splash';
  document.body.appendChild(el);
  return el;
}

describe('dismissing the splash', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the crossfade immediately and retires the layer only once it has finished', () => {
    const splash = splashEl();
    hideSplash(splash);
    expect(splash.classList.contains(SPLASH_HIDE)).toBe(true);
    // Still on screen mid-fade — retiring early would cut the crossfade off.
    vi.advanceTimersByTime(INTRO_DIALS.splashFadeMs - 1);
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(false);

    vi.advanceTimersByTime(300);
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(true);
  });

  it('retires on transitionend without waiting out the fallback timer', () => {
    const splash = splashEl();
    hideSplash(splash);
    splash.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity' }));
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(true);
  });

  it('ignores a child animation finishing — only the layer’s own opacity ends the fade', () => {
    const splash = splashEl();
    const orb = document.createElement('span');
    splash.appendChild(orb);
    hideSplash(splash);

    orb.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'opacity', bubbles: true }));
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(false);
    splash.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform' }));
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(false);
  });

  it('is idempotent — the worker path’s failsafe dismissal cannot stack listeners', () => {
    const splash = splashEl();
    const add = vi.spyOn(splash, 'addEventListener');
    hideSplash(splash);
    hideSplash(splash);
    hideSplash(splash);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('never retires a splash a replay has put back on screen', () => {
    const splash = splashEl();
    hideSplash(splash);
    // "Replay intro" rebuilds this same element mid-fade — __ospSplash() drops --hide.
    splash.classList.remove(SPLASH_HIDE);
    vi.advanceTimersByTime(INTRO_DIALS.splashFadeMs + 1000);
    expect(splash.classList.contains(SPLASH_RETIRED)).toBe(false);
  });

  it('tolerates a missing splash (the intro is non-essential, it must never throw)', () => {
    expect(() => hideSplash(null)).not.toThrow();
    expect(() => hideSplash(document.getElementById('nope'))).not.toThrow();
  });
});
