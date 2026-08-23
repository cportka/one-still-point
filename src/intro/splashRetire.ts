import { INTRO_DIALS } from './introTimeline';

/** Marks a splash whose crossfade has finished, so it can leave the compositor. */
export const SPLASH_RETIRED = 'osp-splash--retired';
/** The class that starts the crossfade (CSS owns the transition itself). */
export const SPLASH_HIDE = 'osp-splash--hide';

/**
 * Dismiss the load splash — fade it out, then take it out of the compositor.
 *
 * Only the first half of this ever existed. `#osp-splash` is a full-viewport
 * `position: fixed; z-index: 2000` layer holding a full-screen 2D canvas and a handful of
 * `will-change: transform, opacity` children, and adding `--hide` only drives it to
 * `opacity: 0` — it stayed live, promoted, and stacked over the WebGPU canvas for the rest of
 * the session. (Both `intro.css` and `main.ts` already *described* a node that gets retired
 * after the fade; nothing did it.) Retiring it hands those layers back.
 *
 * `display: none` rather than `remove()`, because "Replay intro" rebuilds this same element —
 * `__ospSplash()` clears both classes on the way back in.
 *
 * Idempotent: a second call on an already-hidden splash does nothing, so the worker path's
 * failsafe dismissals can't stack listeners.
 */
export function hideSplash(splash: Element | null | undefined): void {
  if (!splash || splash.classList.contains(SPLASH_HIDE)) return;
  splash.classList.add(SPLASH_HIDE);

  const retire = (): void => {
    // "Replay intro" can rebuild this same element while the fallback timer is still pending —
    // `__ospSplash()` clears `--hide` on the way back in. Retiring then would `display: none` a
    // splash that is back on screen, so only retire one that is still on its way out.
    if (splash.classList.contains(SPLASH_HIDE)) splash.classList.add(SPLASH_RETIRED);
    splash.removeEventListener('transitionend', onEnd);
    window.clearTimeout(timer);
  };
  const onEnd = (e: Event): void => {
    // Only the layer's own opacity fade ends the crossfade — child animations bubble here too.
    if (e.target === splash && (e as TransitionEvent).propertyName === 'opacity') retire();
  };
  splash.addEventListener('transitionend', onEnd);
  // The transition can be skipped entirely — a backgrounded tab, reduced-motion settings, or an
  // element already at opacity 0 never fire `transitionend`. The timer is the guarantee.
  const timer = window.setTimeout(retire, INTRO_DIALS.splashFadeMs + 250);
}
