/**
 * A worker-side stand-in for the canvas element, implementing exactly the DOM surface three's
 * `OrbitControls` touches (r184 audit: `style`, `add/removeEventListener`, `getRootNode`,
 * `ownerDocument`, `getBoundingClientRect`, `clientWidth/Height`, `set/releasePointerCapture`) —
 * OrbitControls even routes its document-level listeners through `getRootNode()` "for offscreen
 * canvas compatibility", i.e. this exact pattern. The main thread captures real pointer/wheel
 * events on the on-page canvas and replays them here as plain objects (worker scopes have no
 * `PointerEvent` constructor), so `CameraRig`/`OrbitControls` run in the worker unmodified.
 *
 * Pure JS + a local listener map — no DOM, no three import — so it unit-tests on Node.
 */

/** The plain-object stand-in for a DOM event, carrying the fields OrbitControls reads. */
export interface ProxiedEvent {
  type: string;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

type Listener = (event: ProxiedEvent) => void;

export class ElementProxy {
  /** CSS-pixel size (OrbitControls normalizes drag rotation by `clientHeight`). */
  clientWidth: number;
  clientHeight: number;
  /** OrbitControls assigns `style.touchAction`; a plain bag is enough. */
  readonly style: Record<string, string> = {};
  /** OrbitControls attaches its move/up listeners via `ownerDocument` / `getRootNode()`. */
  readonly ownerDocument: this;

  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(cssWidth = 1, cssHeight = 1) {
    this.clientWidth = Math.max(1, cssWidth);
    this.clientHeight = Math.max(1, cssHeight);
    this.ownerDocument = this;
  }

  setSize(cssWidth: number, cssHeight: number): void {
    this.clientWidth = Math.max(1, cssWidth);
    this.clientHeight = Math.max(1, cssHeight);
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Replay a main-thread event: build the plain event object and fire the listeners for `type`. */
  dispatch(type: string, props: Omit<Partial<ProxiedEvent>, 'type'> = {}): void {
    const event: ProxiedEvent = {
      type,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...props,
    };
    // Copy: a listener may remove itself (OrbitControls does on pointerup).
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  getRootNode(): this {
    return this; // OrbitControls' "offscreen canvas compatibility" hook — the proxy is its own root
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number } {
    return { left: 0, top: 0, x: 0, y: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }

  // Pointer capture is a main-thread concern (the real canvas captures); no-ops here.
  setPointerCapture(_pointerId: number): void {}
  releasePointerCapture(_pointerId: number): void {}
}
