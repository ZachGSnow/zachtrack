// A press and hold on a touch screen, or a right-click (and the keyboard's
// menu key) elsewhere, as a Svelte action: a task's quick menu (3.77). The
// hold is half a second without moving more than a few pixels; a drag handle
// or a box being typed in doesn't count. Android also reports a hold as a
// `contextmenu` event, which opens the menu instead of the browser's own; the
// two never open it twice. The tap that ends a hold isn't a tap on anything:
// by then the menu's backdrop is under the finger, and the tap would close it.

const HOLD_MS = 500;
const SLOP = 8;

export function longPress(node: HTMLElement, onpress: () => void) {
  let callback = onpress;
  let timer = 0;
  let start: { x: number; y: number; id: number } | null = null;
  /** The menu opened during this press, so a second signal for it (Android's contextmenu) doesn't open it again. */
  let opened = false;

  const ignore = (target: EventTarget | null) => !!(target as Element | null)?.closest?.('[data-drag-handle], input, textarea, select');

  function cancel() {
    clearTimeout(timer);
    start = null;
  }

  function open(byTouch: boolean) {
    const touching = byTouch || start !== null;
    cancel();
    if (opened) return;
    opened = touching;
    if (touching) swallowNextTap();
    callback();
  }

  function down(e: PointerEvent) {
    opened = false;
    if (e.pointerType !== 'touch' || ignore(e.target)) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      navigator.vibrate?.(10);
      open(true);
    }, HOLD_MS);
  }

  function move(e: PointerEvent) {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel();
  }

  function contextmenu(e: MouseEvent) {
    if (ignore(e.target)) return;
    e.preventDefault();
    open(false);
  }

  /**
   * Swallows the click a lifted finger may still send, wherever it lands, while
   * the finger is down and for a moment after it lifts; a later tap is a tap.
   */
  function swallowNextTap() {
    let timer = 0;
    const lifted = () => {
      clearTimeout(timer);
      timer = window.setTimeout(done, 400);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      done();
    };
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('pointercancel', lifted, true);
      window.removeEventListener('click', click, true);
    };
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('pointercancel', lifted, true);
    window.addEventListener('click', click, true);
  }

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', contextmenu);
  return {
    update(next: () => void) {
      callback = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('contextmenu', contextmenu);
    },
  };
}
