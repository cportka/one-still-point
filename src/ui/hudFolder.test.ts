// @vitest-environment jsdom
import GUI, { type Controller } from 'lil-gui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHudFolder } from './hudFolder';
import type { Hud } from './hud';

const fakeHud = (): Hud => ({ update: vi.fn(), setVisible: vi.fn(), setOptions: vi.fn(), wantsMap: false });
const tip = <T extends Controller>(c: T): T => c; // no-op tooltip in tests

let gui: GUI;
afterEach(() => gui?.destroy());

const titleBox = (folder: GUI) => folder.$title.querySelector<HTMLInputElement>('input.osp-hud-titlebox')!;

describe('createHudFolder', () => {
  it('builds a collapsed "Display HUD" folder with a title checkbox and three children', () => {
    gui = new GUI({ autoPlace: false });
    const hud = fakeHud();
    createHudFolder(gui, hud, { showFps: false }, tip);

    const folder = gui.folders[0]!;
    expect(folder.$title.textContent).toContain('Display HUD');
    expect(folder._closed).toBe(true); // collapsed by default
    expect(titleBox(folder)).toBeTruthy();
    // The child toggles (the hidden source-of-truth controller doesn't count).
    const childNames = folder.controllers.map((c) => c.domElement.textContent);
    expect(childNames.some((n) => n?.includes('Frame-time graph'))).toBe(true);
    expect(childNames.some((n) => n?.includes('Detail'))).toBe(true);
    expect(childNames.some((n) => n?.includes('Orbit map'))).toBe(true);
  });

  it('starts hidden, with the Orbit map as the only default-on child', () => {
    gui = new GUI({ autoPlace: false });
    const hud = fakeHud();
    createHudFolder(gui, hud, { showFps: false }, tip);
    expect(hud.setVisible).toHaveBeenCalledWith(false); // HUD off by default
    // From the live review: a fresh "Display HUD" shows just the map — the numbers (fps +
    // resolution now ride Detail) and the graph are opt-in.
    expect(hud.setOptions).toHaveBeenCalledWith({ graph: false, detail: false, map: true });
    expect(titleBox(gui.folders[0]!).checked).toBe(false);
  });

  it('the title checkbox toggles HUD visibility', () => {
    gui = new GUI({ autoPlace: false });
    const hud = fakeHud();
    createHudFolder(gui, hud, { showFps: false }, tip);
    const box = titleBox(gui.folders[0]!);

    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(hud.setVisible).toHaveBeenLastCalledWith(true);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(hud.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("the checkbox stops click propagation so it doesn't also expand the folder", () => {
    gui = new GUI({ autoPlace: false });
    createHudFolder(gui, fakeHud(), { showFps: false }, tip);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stop = vi.spyOn(ev, 'stopPropagation');
    titleBox(gui.folders[0]!).dispatchEvent(ev);
    expect(stop).toHaveBeenCalled();
  });

  it('the returned toggle() flips visibility and mirrors the checkbox (the F key)', () => {
    gui = new GUI({ autoPlace: false });
    const hud = fakeHud();
    const { toggle } = createHudFolder(gui, hud, { showFps: false }, tip);
    const box = titleBox(gui.folders[0]!);

    toggle();
    expect(hud.setVisible).toHaveBeenLastCalledWith(true);
    expect(box.checked).toBe(true); // mirror kept in sync
    toggle();
    expect(hud.setVisible).toHaveBeenLastCalledWith(false);
    expect(box.checked).toBe(false);
  });
});
