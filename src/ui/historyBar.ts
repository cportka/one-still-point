import type { History } from '../core/History';
import type { SceneEvent } from '../scene/Scene';

/** Soft, warm-neon colours per transient event type (tuned against the disk palette).
 *  Exported so the info popover's colour key stays in lockstep (one source of truth). */
export const EVENT_COLOR: Record<SceneEvent, string> = {
  star: '#ffd49a', // warm gold
  planet: '#8fb4ff', // cool blue
  hole: '#c79cff', // violet
  // The four transient fates, pushed to well-separated hues (live review: escape↔rescue and
  // merge↔absorb read too alike). absorb = pure red, escape = cyan, rescue = green, merge = magenta.
  absorb: '#ff4d3d', // red — a body fell into the central hole
  escape: '#33c7e6', // cyan — flung clear of the scene
  rescue: '#5fe06b', // green — snatched back from the plunge (a save)
  merge: '#ff5ec8', // magenta — two companions collided and merged
};

/** Human labels for the colour key, in the order the key should list them (adds, then losses). */
export const EVENT_LEGEND: ReadonlyArray<readonly [SceneEvent, string]> = [
  ['star', 'Star added'],
  ['planet', 'Planet added'],
  ['hole', 'Black hole added'],
  ['absorb', 'Absorbed'],
  ['escape', 'Escaped'],
  ['rescue', 'Rescued'],
  ['merge', 'Bodies merged'],
];

interface LoggedEvent {
  type: SceneEvent;
  at: number; // History.recorded at the time — a fixed point on the scrolling window
}

/**
 * A small, bounded log of transient scene events (adds / absorptions / escapes), each
 * tagged with the History frame counter at the time, so it keeps a fixed position on the
 * timeline as the rolling window scrolls and old frames are lost.
 */
export class EventLog {
  private events: LoggedEvent[] = [];
  constructor(private readonly cap = 256) {}

  add(type: SceneEvent, at: number): void {
    this.events.push({ type, at });
    if (this.events.length > this.cap) this.events.shift();
  }

  /** Events whose frame index lands in `[minAt, maxAt]`, as `{type, pos}` with `pos`
   *  normalized 0..1 across that window (`minAt` → 0, `maxAt` → 1). */
  inWindow(minAt: number, maxAt: number): { type: SceneEvent; pos: number }[] {
    const span = Math.max(1, maxAt - minAt);
    const out: { type: SceneEvent; pos: number }[] = [];
    for (const e of this.events) {
      if (e.at < minAt || e.at > maxAt) continue;
      out.push({ type: e.type, pos: (e.at - minAt) / span });
    }
    return out;
  }

  /** Drop events at frame index `at` or newer — the discarded "future" when a live edit made while
   *  scrubbed makes the current moment the new live edge (see {@link Timeline.commit}). */
  dropFrom(at: number): void {
    this.events = this.events.filter((e) => e.at < at);
  }

  clear(): void {
    this.events = [];
  }
}

export interface HistoryBar {
  /** Show / hide the bar (tied to the control panel's visibility, not Pause). */
  setVisible(on: boolean): void;
  /** Drive the markers — call once per render frame. It reflects the Timeline: the *current
   *  marker* rides `currentPos` (the live edge while playing, the scrubbed/replaying frame
   *  otherwise) and the *start marker* sits at `startPos` (the rewind limit). */
  tick(): void;
  dispose(): void;
}

/**
 * The **history scrub bar** — a soft warm-neon line along the exact bottom of the screen, shown
 * alongside the control panel (always on; hidden during a Replay with it). It plots the last
 * ~2 min of simulation: colour-coded **transient-event** ticks (a body added / absorbed /
 * escaped), a brighter "scrubable" fill over the part the current body layout can restore, a
 * **start marker** at the rewind limit (how far back you can go), and a glowing **current
 * marker** at the playback position. **Click** jumps to that moment; **click-and-drag** scrubs —
 * each position restores that frame onto the bodies (`onScrub` freezes the sim for the drag). On
 * release the sim plays on *from that frame* and the current marker walks back to the live edge
 * (bottom-right), where new history is generated — all without touching Pause.
 */
export function createHistoryBar(opts: {
  /** The recorded tape's shape — the real `History` on the main path, or a message-fed mirror
   *  `{ length, recorded }` on the worker path (the bar only reads these two numbers). */
  history: Pick<History, 'length' | 'recorded'>;
  events: EventLog;
  /** Scrub to a normalized position 0..1 (0 = oldest, 1 = now). Returns the *clamped*
   *  position actually applied (restore only works within the current body layout). */
  scrubTo: (pos01: number) => number;
  /** The current ("playback") marker position 0..1 — 1 = the live edge. */
  currentPos: () => number;
  /** The start-marker position 0..1 — the rewind limit (oldest restorable frame). */
  startPos: () => number;
  /** Called on grab (true) / release (false) so the host can freeze the sim while the user
   *  drags — a clean scrub with no physics stepping the bodies off the restored frame. */
  onScrub?: (active: boolean) => void;
}): HistoryBar {
  const { history, events, scrubTo, currentPos, startPos, onScrub } = opts;

  const el = document.createElement('div');
  el.className = 'osp-history';
  el.innerHTML =
    `<div class="osp-history__track">` +
    `<div class="osp-history__fill"></div>` + // brighter over the scrubable (current-generation) span
    `<div class="osp-history__events"></div>` + // colour-coded transient-event ticks
    `<div class="osp-history__live"></div>` + // the live edge ("now" — where new history accrues)
    `<div class="osp-history__start"></div>` + // start marker — the rewind limit
    `<div class="osp-history__head"></div>` + // current marker — the playback position
    `</div>`;
  document.body.appendChild(el);

  const track = el.querySelector<HTMLElement>('.osp-history__track')!;
  const fill = el.querySelector<HTMLElement>('.osp-history__fill')!;
  const eventsEl = el.querySelector<HTMLElement>('.osp-history__events')!;
  const startEl = el.querySelector<HTMLElement>('.osp-history__start')!;
  const headEl = el.querySelector<HTMLElement>('.osp-history__head')!;

  let visible = false;
  let dragging = false;
  let frames = 0; // throttle counter for the slower-moving start marker + event ticks

  const setHead = (pos: number): void => {
    headEl.style.left = `${pos * 100}%`;
  };

  // The start marker + the restorable fill both sit at the rewind limit (startPos).
  const setStart = (pos: number): void => {
    startEl.style.left = `${pos * 100}%`;
    fill.style.left = `${pos * 100}%`;
  };

  // Reused tick nodes — never `replaceChildren()` + recreate per refresh. That rebuild ran ~10×/s
  // and, with the whole event set rebuilt each time, churned the DOM (alloc + a container reflow) on
  // a regular cadence — a cross-platform main-thread stutter. Instead we keep a pool, update the
  // live ones in place, and hide the rest (no node create/destroy on the hot path).
  const eventPool: HTMLDivElement[] = [];
  const renderEvents = (): void => {
    const len = history.length;
    const minAt = history.recorded - len; // oldest frame's absolute index
    const maxAt = history.recorded - 1; // newest (now)
    const start = startPos(); // left of here is older history the current layout can't restore
    const inWin = events.inWindow(minAt, maxAt);
    for (let i = eventPool.length; i < inWin.length; i++) {
      const tick = document.createElement('div'); // grow the pool only when more events than ever appear
      eventsEl.appendChild(tick);
      eventPool.push(tick);
    }
    for (let i = 0; i < inWin.length; i++) {
      const e = inWin[i]!;
      const tick = eventPool[i]!;
      // Events before the rewind limit are *locked* (can't scrub to them) — dim them so the
      // bright, scrubable span reads as "live history" against the dim "no-history" past.
      tick.className = e.pos < start - 1e-3 ? 'osp-history__event osp-history__event--locked' : 'osp-history__event';
      tick.style.left = `${e.pos * 100}%`;
      tick.style.setProperty('--osp-ev', EVENT_COLOR[e.type]);
      tick.style.display = '';
    }
    for (let i = inWin.length; i < eventPool.length; i++) eventPool[i]!.style.display = 'none'; // park the rest
  };

  const posFromEvent = (e: PointerEvent): number => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  };

  const onDown = (e: PointerEvent): void => {
    if (!visible) return;
    dragging = true;
    onScrub?.(true); // freeze the sim for a clean scrub
    track.setPointerCapture(e.pointerId);
    setHead(scrubTo(posFromEvent(e))); // a single click already jumps; a drag keeps scrubbing
  };
  const onMove = (e: PointerEvent): void => {
    if (dragging) setHead(scrubTo(posFromEvent(e)));
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    onScrub?.(false); // resume — the sim plays on from the scrubbed frame
    try {
      track.releasePointerCapture(e.pointerId);
    } catch {
      /* wasn't captured */
    }
  };
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  track.addEventListener('pointercancel', onUp);

  return {
    setVisible(on: boolean): void {
      if (on === visible) return; // idempotent: a redundant show (panel mount *and* formation.onDone
      // both fire it on first load) must not snap the markers off a scrub.
      visible = on;
      el.classList.toggle('osp-history--on', on);
      if (on) {
        frames = 0;
        setStart(startPos()); // the rewind-limit marker fades in with the bar
        renderEvents();
        setHead(currentPos()); // the current marker (1 at the live edge)
      } else {
        dragging = false;
      }
    },
    tick(): void {
      if (!visible) return;
      setHead(currentPos()); // every frame — smooth as the marker rides "now" or replays forward
      // The event ticks + start marker drift only as the ~2-min window scrolls (sub-pixel per frame),
      // so refresh them a few times a second, not every frame — less periodic main-thread work.
      if (frames++ % 12 === 0) {
        setStart(startPos()); // the rewind limit moves slowly (body-set changes / window eviction)
        renderEvents();
      }
    },
    dispose(): void {
      el.remove();
    },
  };
}
