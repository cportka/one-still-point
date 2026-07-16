// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { attachTouchTooltips } from './touchTooltips';

/** A lil-gui-shaped row: a [title] container holding a .name label + a .widget control. */
const makeRow = (root: HTMLElement, title: string, label: string): { name: HTMLElement; widget: HTMLElement } => {
  const row = document.createElement('div');
  row.setAttribute('title', title);
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = label;
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.innerHTML = '<input type="checkbox">';
  row.append(name, widget);
  root.appendChild(row);
  return { name, widget };
};

const click = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));
};

const popup = (): HTMLElement => document.querySelector('.osp-tooltip')!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('attachTouchTooltips — click-to-toggle (v0.97.2)', () => {
  it('clicking a row LABEL shows its tooltip pinned; clicking again closes it', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { name } = makeRow(root, 'Freeze the simulation.', 'Pause');
    attachTouchTooltips(root);

    click(name);
    expect(popup().classList.contains('is-visible')).toBe(true);
    expect(popup().textContent).toBe('Freeze the simulation.');
    click(name);
    expect(popup().classList.contains('is-visible')).toBe(false);
  });

  it('clicking another label switches the popup to that row', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const a = makeRow(root, 'First help.', 'A');
    const b = makeRow(root, 'Second help.', 'B');
    attachTouchTooltips(root);

    click(a.name);
    expect(popup().textContent).toBe('First help.');
    click(b.name);
    expect(popup().classList.contains('is-visible')).toBe(true);
    expect(popup().textContent).toBe('Second help.');
  });

  it('clicking the WIDGET never toggles a tooltip — controls keep working undisturbed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { widget } = makeRow(root, 'Help.', 'Row');
    attachTouchTooltips(root);

    click(widget.querySelector('input')! as HTMLElement);
    expect(popup().classList.contains('is-visible')).toBe(false);
  });

  it('a click anywhere outside the panel dismisses a pinned tooltip', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const { name } = makeRow(root, 'Help.', 'Row');
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    attachTouchTooltips(root);

    click(name);
    expect(popup().classList.contains('is-visible')).toBe(true);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(popup().classList.contains('is-visible')).toBe(false);
  });

  it('rows without a title stay silent', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const bare = document.createElement('div');
    bare.innerHTML = '<div class="name">No help here</div>';
    root.appendChild(bare);
    attachTouchTooltips(root);

    click(bare.querySelector('.name')! as HTMLElement);
    expect(popup().classList.contains('is-visible')).toBe(false);
  });
});
