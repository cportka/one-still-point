/**
 * A clickable version chip pinned to the top of the control panel. Clicking it
 * copies the version to the clipboard and briefly flips the label to a green
 * check (CSS handles the fade/pop via the `is-copied` class).
 */
export function createVersionBadge(version: string): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'osp-version';
  el.title = 'Copy version';
  el.setAttribute('data-nosnippet', ''); // UI chrome — keep out of search snippets

  const label = document.createElement('span');
  label.className = 'osp-version__label';
  label.textContent = `v${version}`;

  const check = document.createElement('span');
  check.className = 'osp-version__check';
  check.textContent = '✓ copied';

  el.append(label, check);

  let timer = 0;
  const flash = (): void => {
    el.classList.add('is-copied');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('is-copied'), 1200);
  };

  el.addEventListener('click', () => {
    const clip = navigator.clipboard;
    if (clip?.writeText) {
      void clip.writeText(`v${version}`).then(flash, flash);
    } else {
      flash();
    }
  });

  return el;
}
