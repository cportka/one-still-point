// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDirector } from '../audio/AudioDirector';
import { attachMusicMark } from './musicMark';

/** A stand-in for lil-gui's GUI: a root element plus a `<button>` title — the shape that forces
 *  the mark to mount as a sibling rather than a child. */
function fakeGui(): { domElement: HTMLElement; $title: HTMLButtonElement } {
  const domElement = document.createElement('div');
  const $title = document.createElement('button');
  domElement.appendChild($title);
  document.body.appendChild(domElement);
  return { domElement, $title };
}

/** Give jsdom's unimplemented HTMLMediaElement enough behaviour to model play/pause, and hand
 *  back the `<audio>` the director creates (it lives detached, so the DOM can't be queried). */
function stubMedia(opts: { fail?: boolean } = {}): {
  el: () => HTMLAudioElement | null;
  plays: () => number;
} {
  let playing = false;
  let plays = 0;
  let audioEl: HTMLAudioElement | null = null;

  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => !playing);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {
    plays++;
    if (opts.fail) throw new Error('NotAllowedError');
    playing = true;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    playing = false;
  });
  // jsdom leaves load() unimplemented and logs about it; the director already tolerates that.
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);

  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const node = real(tag as 'div');
    if (tag === 'audio') audioEl = node as HTMLAudioElement;
    return node;
  }) as typeof document.createElement);

  return { el: () => audioEl, plays: () => plays };
}

describe('the panel mark as the score transport', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('mounts as a sibling of the title — a <button> cannot nest inside a <button>', () => {
    stubMedia();
    const gui = fakeGui();
    const music = attachMusicMark(gui);
    expect(music.element.tagName).toBe('BUTTON');
    expect(gui.$title.contains(music.element)).toBe(false);
    // Still inside the panel root, which is what the "click outside closes" rule tests.
    expect(gui.domElement.contains(music.element)).toBe(true);
  });

  it('starts as an idle play button and toggles to pause once the score is running', async () => {
    stubMedia();
    const music = attachMusicMark(fakeGui());
    expect(music.state).toBe('idle');
    expect(music.element.getAttribute('aria-label')).toBe('Play the score');

    await music.toggle();
    expect(music.state).toBe('playing');
    expect(music.element.dataset.state).toBe('playing');
    expect(music.element.getAttribute('aria-label')).toBe('Pause the score');

    await music.toggle();
    expect(music.state).toBe('idle');
    expect(music.element.getAttribute('aria-label')).toBe('Play the score');
  });

  it('a click drives the transport and never reaches the fold handler', async () => {
    stubMedia();
    const gui = fakeGui();
    const folds = vi.fn();
    gui.$title.addEventListener('click', folds);
    const music = attachMusicMark(gui);

    music.element.click();
    await vi.waitFor(() => expect(music.state).toBe('playing'));
    expect(folds).not.toHaveBeenCalled();
  });

  it('a click on the panel title itself never touches the transport', async () => {
    stubMedia();
    const gui = fakeGui();
    const music = attachMusicMark(gui);
    // The handler lives on the mark alone, so folding the panel can't start the score. (v1.0.0
    // shipped the mark stretched over the whole title row by a CSS specificity loss, which made
    // every header click a play/pause — the cascade guard for that is musicMarkStyles.test.ts.)
    gui.$title.click();
    await Promise.resolve();
    expect(music.state).toBe('idle');
  });

  it('plays the uploaded score, on a loop, and fetches nothing before the click', async () => {
    const media = stubMedia();
    const music = attachMusicMark(fakeGui());
    await music.toggle();

    const el = media.el();
    expect(el).not.toBeNull();
    expect(el!.src).toContain('/audio/OneStillPoint.m4a');
    expect(el!.loop).toBe(true); // a lone track loops natively — no JS on the seam
    expect(el!.preload).toBe('none'); // nothing over the wire until the user asks
  });

  it('resuming after a pause keeps the score where it left off (pause, not stop)', async () => {
    const media = stubMedia();
    const music = attachMusicMark(fakeGui());
    await music.toggle();
    const src = media.el()!.src;

    await music.toggle(); // pause
    expect(media.el()!.paused).toBe(true);
    await music.toggle(); // resume
    expect(music.state).toBe('playing');
    // Played twice off the same source — never re-pointed, so the position survives.
    expect(media.plays()).toBe(2);
    expect(media.el()!.src).toBe(src);
  });

  it('a refused or missing track disables the control instead of leaving a dead button', async () => {
    stubMedia({ fail: true });
    const music = attachMusicMark(fakeGui());
    await music.toggle();
    expect(music.state).toBe('unavailable');
    expect(music.element.disabled).toBe(true);
    expect(music.element.getAttribute('aria-label')).toBe('The score could not be loaded');
    // And it stays inert from there.
    await music.toggle();
    expect(music.state).toBe('unavailable');
  });

  it('unmutes on the click — the director is silent until a user asks for sound', async () => {
    const media = stubMedia();
    const audio = new AudioDirector();
    expect(audio.muted).toBe(true);
    const music = attachMusicMark(fakeGui(), audio);
    await music.toggle();
    expect(audio.muted).toBe(false);
    expect(audio.musicPlaying).toBe(true);
    expect(media.el()!.volume).toBeGreaterThan(0);
  });

  it('destroy() removes the control and leaves a shared director alone', async () => {
    stubMedia();
    const audio = new AudioDirector();
    const dispose = vi.spyOn(audio, 'dispose');
    const gui = fakeGui();
    const music = attachMusicMark(gui, audio);
    await music.toggle();
    music.destroy();
    expect(gui.domElement.contains(music.element)).toBe(false);
    expect(dispose).not.toHaveBeenCalled(); // not ours to dispose
  });
});

describe('AudioDirector music bed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('streams the score rather than decoding it into a buffer', async () => {
    const media = stubMedia();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const audio = new AudioDirector();
    await audio.startMusic();
    // A 3-minute track through decodeAudioData would be ~70 MB of PCM; the element streams it.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(media.el()).not.toBeNull();
  });

  it('holds the score silent while muted and restores the set volume on unmute', async () => {
    const media = stubMedia();
    const audio = new AudioDirector();
    audio.setVolume(0.5);
    await audio.startMusic(); // muted by default
    expect(media.el()!.volume).toBe(0);
    audio.setMuted(false);
    expect(media.el()!.volume).toBeCloseTo(0.5, 5);
    audio.setMuted(true);
    expect(media.el()!.volume).toBe(0);
  });

  it('dispose() releases the stream', async () => {
    const media = stubMedia();
    const audio = new AudioDirector();
    await audio.startMusic();
    const el = media.el()!;
    audio.dispose();
    expect(el.paused).toBe(true);
    expect(el.getAttribute('src')).toBeNull();
  });
});
