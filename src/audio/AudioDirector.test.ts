import { describe, expect, it } from 'vitest';
import { AudioDirector } from './AudioDirector';

/**
 * The scaffolding contract: with an empty manifest and no WebAudio in the environment (Node),
 * every call is a clean no-op — the app can wire the director in before any asset exists.
 */
describe('AudioDirector (scaffolding no-op safety)', () => {
  it('every method is safe without WebAudio, an unlock, or any assets', () => {
    const audio = new AudioDirector();
    expect(audio.muted).toBe(true); // sound is opt-in
    expect(() => {
      audio.unlock(); // no AudioContext in Node → stays a permanent no-op
      audio.startMusic(); // empty pool
      audio.sfx('absorb'); // unregistered one-shot
      audio.sfx('intro-merger');
      audio.setVolume(0.4);
      audio.setMuted(false);
      audio.stopMusic();
      audio.dispose();
    }).not.toThrow();
  });
});
