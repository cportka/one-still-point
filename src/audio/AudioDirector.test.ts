import { describe, expect, it } from 'vitest';
import { AudioDirector } from './AudioDirector';

/**
 * The safety contract: with no DOM and no WebAudio in the environment (plain Node), every call
 * is a clean no-op. The director is constructed from UI code that also runs under SSR-ish and
 * headless conditions, so it must never assume either API exists.
 */
describe('AudioDirector (no-op safety without a DOM or WebAudio)', () => {
  it('every method is safe without WebAudio, an unlock, or a document', async () => {
    const audio = new AudioDirector();
    expect(audio.muted).toBe(true); // sound is opt-in
    // No `document` here, so the music element can never be created — startMusic reports failure
    // rather than throwing, which is exactly what the panel mark reads to disable itself.
    await expect(audio.startMusic()).resolves.toBe(false);
    expect(audio.musicPlaying).toBe(false);
    expect(() => {
      audio.unlock(); // no AudioContext in Node → stays a permanent no-op
      audio.sfx('absorb'); // unregistered one-shot
      audio.sfx('intro-merger');
      audio.setVolume(0.4);
      audio.setMuted(false);
      audio.pauseMusic();
      audio.dispose();
    }).not.toThrow();
  });
});
