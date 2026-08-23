import { MUSIC_TRACKS, SFX, type SfxName, type TrackDef } from './manifest';
import { createRotation } from './rotation';

/**
 * The audio spine: a **music** bed that walks the manifest's track pool, and one-shot **SFX**
 * keyed to the intro beats + scene events.
 *
 * The two families use different machinery on purpose:
 *
 *  - **Music streams from an `<audio>` element.** The score is ~3 minutes long; run through
 *    `decodeAudioData` it would sit in memory as ~70 MB of float PCM (188 s × 48 kHz × 2ch × 4 B)
 *    for the whole session — not a thing to hold next to a WebGPU render loop on a phone. An
 *    element streams it, seeks cheaply, and loops natively without JS on the seam. It also means
 *    music works even where `AudioContext` doesn't.
 *  - **SFX decode into WebAudio buffers**, where one-shots need to be sample-accurate and
 *    overlapping. Those still require `unlock()` from a real user gesture.
 *
 * Design constraints, baked in:
 *  - **Autoplay policy**: nothing sounds until the user asks for it. `startMusic()` is only ever
 *    called from a click, and `unlock()` creates/resumes the `AudioContext` from that same gesture.
 *  - **Muted by default**: sound is opt-in — a courtesy default for a contemplative page.
 *  - Per-asset `gainDb` trims mix against the master; `setVolume` drives the master.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private nextTrack = createRotation(MUSIC_TRACKS.length);
  private musicEl: HTMLAudioElement | null = null;
  private musicTrack: TrackDef | null = null;
  private musicOn = false;
  private volume = 0.7;
  private mutedFlag = true;

  /** Create/resume the context for SFX — call from a user gesture (pointer/keydown). Idempotent. */
  unlock(): void {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return; // no WebAudio here (jsdom, very old browsers) — stay a no-op forever
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.applyGain();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.applyGain();
  }

  /** Master volume 0..1 (kept even while muted, so unmute restores it). */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyGain();
  }

  /** True while the bed is actually sounding (not merely requested). */
  get musicPlaying(): boolean {
    return this.musicOn && !!this.musicEl && !this.musicEl.paused;
  }

  /**
   * Begin (or resume) the music bed, looping forever. Resolves **true** once the element is
   * really playing — the panel's play/pause mark uses that to tell "playing" apart from "this
   * track can't be played here" (missing asset, decode failure, a browser that refused the
   * gesture). Never rejects.
   */
  async startMusic(): Promise<boolean> {
    this.musicOn = true;
    const el = this.ensureMusicEl();
    if (!el) return false;
    if (!this.musicTrack && !this.cueNext(el)) return false;
    this.applyGain();
    try {
      await el.play();
    } catch {
      this.musicOn = false;
      return false;
    }
    return true;
  }

  /** Pause the bed, keeping its position — resuming picks the score back up where it left off. */
  pauseMusic(): void {
    this.musicOn = false;
    this.musicEl?.pause();
  }

  /** Fire a one-shot for a named moment. Unregistered names (all of them, today) no-op. */
  sfx(name: SfxName): void {
    const def = SFX[name];
    if (!def || !this.ctx || !this.sfxBus || this.mutedFlag) return;
    void this.load(def.url).then((buffer) => {
      if (!buffer || !this.ctx || !this.sfxBus) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const trim = this.ctx.createGain();
      trim.gain.value = dbToGain(def.gainDb ?? 0);
      source.connect(trim);
      trim.connect(this.sfxBus);
      source.start();
    });
  }

  dispose(): void {
    this.pauseMusic();
    if (this.musicEl) {
      this.musicEl.removeAttribute('src');
      // Drop the buffered stream. jsdom leaves `load` unimplemented — releasing memory is a
      // best-effort courtesy, never a correctness requirement.
      try {
        this.musicEl.load();
      } catch {
        /* not implemented here */
      }
      this.musicEl = null;
    }
    this.musicTrack = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.buffers.clear();
  }

  private applyGain(): void {
    const gain = this.mutedFlag ? 0 : this.volume;
    if (this.master) this.master.gain.value = gain;
    if (this.musicEl) {
      this.musicEl.volume = Math.min(1, Math.max(0, gain * dbToGain(this.musicTrack?.gainDb ?? 0)));
    }
  }

  /** The element is created lazily and lives detached — playback never needs it in the document. */
  private ensureMusicEl(): HTMLAudioElement | null {
    if (this.musicEl) return this.musicEl;
    if (typeof document === 'undefined' || !MUSIC_TRACKS.length) return null;
    const el = document.createElement('audio');
    el.preload = 'none'; // not a byte over the wire until the user asks for sound
    // Only reached by a multi-track pool; a lone track loops natively (see cueNext).
    el.addEventListener('ended', () => {
      if (this.musicOn && this.cueNext(el)) void el.play().catch(() => undefined);
    });
    this.musicEl = el;
    return el;
  }

  /** Point the element at the rotation's next track. False when the pool is empty. */
  private cueNext(el: HTMLAudioElement): boolean {
    const track = MUSIC_TRACKS[this.nextTrack()];
    if (!track) return false;
    this.musicTrack = track;
    el.src = track.url;
    el.loop = MUSIC_TRACKS.length === 1;
    return true;
  }

  /** Fetch + decode once per URL; failures cache as null (a missing asset must not retry-spam). */
  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((bytes) => this.ctx!.decodeAudioData(bytes))
        .catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }
}

const dbToGain = (db: number): number => Math.pow(10, db / 20);
