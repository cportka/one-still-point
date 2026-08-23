import { AudioDirector } from '../audio/AudioDirector';

/**
 * The still Ember-Core mark that rides the panel's title row — and doubles as the score's
 * transport. At rest it is the logo; hover it and it becomes **play**, or **pause** while the
 * score is running. Click toggles.
 *
 * Two structural notes drive the DOM here:
 *
 *  - **It cannot live inside the title.** lil-gui's `$title` is itself a `<button>` (the
 *    fold-the-panel control), and a `<button>` may not nest inside another — the HTML parser
 *    closes the outer one. So the mark is a *sibling*, absolutely positioned over the title
 *    row's right end (`--title-height` / `--padding` are lil-gui's own variables, so the
 *    alignment follows the panel's theme rather than a magic number).
 *  - **A sibling also fixes the click.** Because the mark is not a descendant of `$title`, a
 *    click on it never reaches lil-gui's fold handler, and it still counts as *inside*
 *    `gui.domElement` for the panel's "click outside closes" rule.
 *
 * Being a real `<button>` earns keyboard support for free: `attachKeybindings` already defers
 * Space/Enter to a focused button rather than firing the global Pause shortcut.
 */

/** Where the transport is. `loading` covers the fetch between the click and the first sample. */
export type MusicState = 'idle' | 'loading' | 'playing' | 'unavailable';

const GLYPH: Record<MusicState, string> = {
  idle: '<path d="M9 7.2v9.6l8-4.8z"/>',
  loading: '<path d="M9 7.2v9.6l8-4.8z"/>',
  playing: '<path d="M9 7h2.4v10H9zm3.6 0H15v10h-2.4z"/>',
  unavailable: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/>',
};

const LABEL: Record<MusicState, string> = {
  idle: 'Play the score',
  loading: 'Loading the score…',
  playing: 'Pause the score',
  unavailable: 'The score could not be loaded',
};

/** The minimum a host needs to expose for the mark to mount — lil-gui's `GUI` satisfies it. */
export interface MarkHost {
  domElement: HTMLElement;
  $title: HTMLElement;
}

export interface MusicMark {
  /** The control itself. */
  readonly element: HTMLButtonElement;
  /** Current transport state (the tests' window onto the toggle). */
  readonly state: MusicState;
  /** Drive the transport programmatically — the click handler routes through this too. */
  toggle(): Promise<void>;
  destroy(): void;
}

/**
 * Mount the mark on a panel. Pass an `AudioDirector` to share one bed across both panels;
 * omitted, the mark owns a private one and disposes it with itself.
 */
export function attachMusicMark(host: MarkHost, audio?: AudioDirector): MusicMark {
  const owned = audio === undefined;
  const director = audio ?? new AudioDirector();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'osp-music';

  const mark = document.createElement('img');
  mark.src = '/favicon.svg';
  mark.alt = '';
  mark.setAttribute('aria-hidden', 'true');
  mark.className = 'osp-panel__mark';

  const glyph = document.createElement('span');
  glyph.className = 'osp-music__glyph';
  glyph.setAttribute('aria-hidden', 'true');

  button.append(mark, glyph);
  host.$title.classList.add('osp-panel__title');
  host.domElement.appendChild(button);

  let state: MusicState = 'idle';
  const render = (next: MusicState): void => {
    state = next;
    button.dataset.state = next;
    button.setAttribute('aria-label', LABEL[next]);
    button.title = LABEL[next];
    button.disabled = next === 'unavailable';
    glyph.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${GLYPH[next]}</svg>`;
  };
  render('idle');

  const toggle = async (): Promise<void> => {
    if (state === 'loading' || state === 'unavailable') return;
    if (state === 'playing') {
      director.pauseMusic();
      render('idle');
      return;
    }
    render('loading');
    // The click is the gesture that buys us an AudioContext, and it is also the user opting in
    // to sound — the director is muted until someone asks.
    director.unlock();
    director.setMuted(false);
    const playing = await director.startMusic();
    render(playing ? 'playing' : 'unavailable');
  };

  const onClick = (e: MouseEvent): void => {
    // Belt and braces: the mark is a sibling of the fold button, so nothing would reach it
    // anyway — but this keeps the guarantee if the DOM placement ever moves.
    e.preventDefault();
    e.stopPropagation();
    void toggle();
  };
  button.addEventListener('click', onClick);

  return {
    element: button,
    get state() {
      return state;
    },
    toggle,
    destroy() {
      button.removeEventListener('click', onClick);
      button.remove();
      if (owned) director.dispose();
    },
  };
}
