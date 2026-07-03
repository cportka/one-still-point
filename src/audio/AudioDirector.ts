import { MUSIC_TRACKS, SFX, type SfxName } from './manifest';
import { createRotation } from './rotation';

/**
 * The audio spine (roadmap #11 scaffolding): gesture-unlocked WebAudio with two buses —
 * a **music** bed that walks the manifest's track pool in a non-repeating random rotation,
 * and one-shot **SFX** keyed to the intro beats + scene events.
 *
 * Ships fully guarded: with the manifest empty (today) every method is a clean no-op, so the
 * app can wire the calls in before a single asset exists. Design constraints, baked in:
 *  - **Autoplay policy**: nothing sounds until `unlock()` is called from a real user gesture
 *    (the AudioContext is created/resumed there and nowhere else).
 *  - **Muted by default**: sound is opt-in — a courtesy default for a contemplative page.
 *  - Per-asset `gainDb` trims mix against the buses; `setVolume` drives the master.
 */
export class AudioDirector {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private nextTrack = createRotation(MUSIC_TRACKS.length);
  private musicSource: AudioBufferSourceNode | null = null;
  private musicOn = false;
  private volume = 0.7;
  private mutedFlag = true;

  /** Create/resume the context — call from a user gesture (pointer/keydown). Idempotent. */
  unlock(): void {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return; // no WebAudio here (jsdom, very old browsers) — stay a no-op forever
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.applyGain();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.musicOn && !this.musicSource) this.spinMusic();
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

  /** Begin (or resume) the rotating background bed. No-op until unlock() + a non-empty pool. */
  startMusic(): void {
    this.musicOn = true;
    if (this.ctx && !this.musicSource) this.spinMusic();
  }

  stopMusic(): void {
    this.musicOn = false;
    this.musicSource?.stop();
    this.musicSource = null;
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
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.buffers.clear();
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.mutedFlag ? 0 : this.volume;
  }

  /** Play the rotation's next track; chain the following one on `ended` — forever. */
  private spinMusic(): void {
    const idx = this.nextTrack();
    const track = MUSIC_TRACKS[idx];
    if (!track || !this.ctx || !this.musicBus) return;
    void this.load(track.url).then((buffer) => {
      if (!buffer || !this.ctx || !this.musicBus || !this.musicOn) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      const trim = this.ctx.createGain();
      trim.gain.value = dbToGain(track.gainDb ?? 0);
      source.connect(trim);
      trim.connect(this.musicBus);
      source.onended = () => {
        if (this.musicSource === source) {
          this.musicSource = null;
          if (this.musicOn) this.spinMusic();
        }
      };
      this.musicSource = source;
      source.start();
    });
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
