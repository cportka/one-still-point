/**
 * The audio manifest (roadmap #11 scaffolding) — the single place assets will register.
 *
 * Two families:
 *  - **Music**: a pool of background tracks that rotate randomly (never the same track twice in
 *    a row — see `rotation.ts`) for as long as the page lives.
 *  - **SFX**: one-shots keyed to the moments the app already emits — the intro beats and the
 *    scene's transient events (the same `SceneEvent`s the history bar ticks on).
 *
 * Assets live in `public/audio/` (Vite serves that verbatim; the repo-root `assets/` folder is
 * README material and is never published) and register here — nothing else changes. The
 * `AudioDirector` no-ops cleanly over an empty list, so the SFX side can stay unpopulated while
 * the music side ships.
 */

/** Every moment that can carry a one-shot. Intro beats mirror `intro-script.md`; the scene
 *  events mirror `SceneEvent` (star/planet/hole = a body's arrival tick). */
export type SfxName =
  | 'intro-creation' // the moment-of-creation burst (beat C)
  | 'intro-merger' // the splash's binary-merger flash (beat D)
  | 'reveal' // the splash→engine crossfade
  | 'star' // a star swooshes in (seeded birth or user add)
  | 'planet'
  | 'hole'
  | 'absorb' // a body crosses the merge radius (the ringdown moment)
  | 'absorb-hole' // a BLACK HOLE merger — the overwhelming one (bigger cue than 'absorb')
  | 'escape'; // a body flung free

export interface TrackDef {
  id: string;
  /** Served from `public/audio/` (e.g. `/audio/still-point-i.mp3`). */
  url: string;
  title: string;
  /** Per-track trim in dB against the music bus (mastering headroom differences). */
  gainDb?: number;
}

export interface SfxDef {
  url: string;
  gainDb?: number;
}

/**
 * The rotating background pool. One track today — the score written for the piece — so the
 * rotation is a no-op and the element loops it natively (see `AudioDirector.cueNext`). Adding a
 * second entry here is all it takes to turn the bed back into a shuffle.
 */
export const MUSIC_TRACKS: readonly TrackDef[] = [
  { id: 'one-still-point', url: '/audio/OneStillPoint.m4a', title: 'One Still Point' },
];

/** The one-shot map. Empty until the first effects land (roadmap #11). */
export const SFX: Partial<Record<SfxName, SfxDef>> = {};
