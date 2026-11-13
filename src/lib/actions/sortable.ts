// Drag and drop for lists (ARCHITECTURE.md 3.65, 3.76), as a Svelte action on
// the list element. Its items carry `data-sort-id`; each item's handle carries
// `data-drag-handle`. Dragging starts from the handle, so the rest of a row
// still scrolls, taps and swipes as usual; the handle has `touch-action:
// none`, so a finger drags it straight away on a phone. With `mouseAnywhere`,
// a mouse can also drag an item from anywhere on it once it has moved a few
// pixels, as in Asana; a plain click still clicks. Lists in the same `group`
// exchange items (a task dragged into another section, or a card into another
// column of a board). A list is vertical by default, or horizontal with
// `axis: 'x'` (a board's columns). Dragging one of several selected items
// takes them all (`selection`, 3.77). Arrow keys on a focused handle move it
// one place, for the keyboard. Written here rather than taken from a library to
// keep the dependencies the licence policy checks to a minimum.

import { dropIndex } from '../utils/reorder';

export interface DropEvent {
  /** The item that was dragged. */
  id: string;
  /** Every item that moved: `id` alone, or the selection it is part of, in the order they show. */
  ids: string[];
  /** The `zone` of the list it came from, and of the list it was dropped in. */
  from: string;
  to: string;
  /** Its position in the target list, counted without it. */
  index: number;
}

export interface SortableOptions {
  group: string;
  zone: string;
  onDrop: (e: DropEvent) => void;
  /** Arrow Up / Down (Left / Right on a horizontal list) on a focused handle. */
  onKeyMove?: (id: string, direction: -1 | 1) => void;
  /** 'y' (the default): items stacked top to bottom. 'x': side by side. */
  axis?: 'x' | 'y';
  /** The floating copy follows the pointer both ways, not only along the list (a card moving between columns). */
  free?: boolean;
  /** How far past the end of a list, in pixels, the pointer can be and still drop into it. Default 32. */
  reach?: number;
  /** A container that scrolls sideways, scrolled while the pointer is near its left or right edge. */
  scroller?: () => HTMLElement | null | undefined;
  /** A mouse can drag an item from anywhere on it, not only its handle. */
  mouseAnywhere?: boolean;
  /** The ids selected now: dragging one of them drags them all. */
  selection?: () => readonly string[];
}

interface Zone {
  node: HTMLElement;
  opts: SortableOptions;
}

const groups = new Map<string, Set<Zone>>();

/** How far a mouse moves before a press on an item becomes a drag (`mouseAnywhere`). */
const DRAG_START = 5;

const itemsOf = (node: HTMLElement, except?: ReadonlySet<Element>) =>
  [...node.querySelectorAll<HTMLElement>(':scope > [data-sort-id]')].filter((el) => !except?.has(el));

export function sortable(node: HTMLElement, options: SortableOptions) {
  const zone: Zone = { node, opts: options };
  const join = () => {
    const set = groups.get(zone.opts.group) ?? new Set<Zone>();
    set.add(zone);
    groups.set(zone.opts.group, set);
  };
  join();

  function handleFor(target: EventTarget | null): { handle: HTMLElement; item: HTMLElement } | null {
    const handle = (target as Element | null)?.closest?.<HTMLElement>('[data-drag-handle]');
    const item = handle?.closest<HTMLElement>('[data-sort-id]');
    if (!handle || !item || item.parentElement !== node) return null;
    return { handle, item };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const hit = handleFor(e.target);
    if (hit) {
      e.preventDefault();
      startDrag(e, hit.handle, hit.item);
      return;
    }
    if (zone.opts.mouseAnywhere && e.pointerType === 'mouse') pressAnywhere(e);
  }

  /** A mouse press on an item, outside its handle: a drag once it moves a few pixels, otherwise a click. */
  function pressAnywhere(e: PointerEvent) {
    const target = e.target as Element | null;
    if (!target || target.closest('input, textarea, select, [contenteditable], [data-drag-handle]')) return;
    const item = target.closest<HTMLElement>('[data-sort-id]');
    if (!item || item.parentElement !== node) return;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_START) return;
      stop();
      startDrag(e, item, item, ev);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function startDrag(e: PointerEvent, handle: HTMLElement, item: HTMLElement, now: PointerEvent = e) {
    const id = item.dataset.sortId!;
    // One of several selected items takes the others with it, in the order they show.
    const selected = new Set(zone.opts.selection?.() ?? []);
    const zones = () => [...(groups.get(zone.opts.group) ?? [])].filter((z) => z.node.isConnected);
    const dragged = selected.has(id) && selected.size > 1 ? zones().flatMap((z) => itemsOf(z.node).filter((el) => selected.has(el.dataset.sortId!))) : [item];
    const ids = dragged.map((el) => el.dataset.sortId!);
    const draggedSet = new Set<Element>(dragged);
    const horizontal = zone.opts.axis === 'x';
    const followX = horizontal || !!zone.opts.free;
    const followY = !horizontal || !!zone.opts.free;
    const rect = item.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const ghost = item.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      maxHeight: '60vh',
      overflow: 'hidden',
      zIndex: '60',
      pointerEvents: 'none',
      background: 'var(--color-surface)',
      boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
      borderRadius: '0.75rem',
      opacity: '0.95',
    });
    ghost.removeAttribute('data-sort-id');
    ghost.setAttribute('aria-hidden', 'true');
    if (ids.length > 1) {
      // How many are moving, on the corner of the floating copy.
      const badge = document.createElement('span');
      badge.textContent = String(ids.length);
      Object.assign(badge.style, {
        position: 'absolute',
        top: '4px',
        right: '4px',
        minWidth: '1.5rem',
        padding: '0 0.4rem',
        borderRadius: '9999px',
        background: 'var(--color-brand)',
        color: 'var(--color-brand-fg)',
        font: '600 0.75rem/1.5rem system-ui, sans-serif',
        textAlign: 'center',
      });
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    const line = document.createElement('div');
    Object.assign(line.style, { position: 'fixed', background: 'var(--color-brand)', zIndex: '61', pointerEvents: 'none', display: 'none' });
    document.body.appendChild(line);
    for (const el of dragged) el.style.opacity = '0.35';
    // No text selected by a drag that started on a name.
    const userSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    window.getSelection()?.removeAllRanges();
    // A sideways scroller stops snapping to its columns while it is scrolled by the drag.
    const scroller = zone.opts.scroller?.() ?? null;
    const snap = scroller?.style.scrollSnapType ?? '';
    if (scroller) scroller.style.scrollSnapType = 'none';
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the handle still gets the moves while the pointer is over it.
    }

    let target: { zone: Zone; index: number } | null = null;
    let lastY = now.clientY;
    let lastX = now.clientX;
    let raf = 0;

    const place = () => {
      if (followX) ghost.style.left = `${lastX - offsetX}px`;
      if (followY) ghost.style.top = `${lastY - offsetY}px`;
    };

    const locate = () => {
      // The nearest list along the axis among those the pointer is beside; a list
      // the pointer is inside sideways beats one it is only near (columns a few
      // pixels apart).
      let best: Zone | null = null;
      let bestScore = Infinity;
      const gap = (a: number, lo: number, hi: number) => (a < lo ? lo - a : a > hi ? a - hi : 0);
      for (const z of zones()) {
        const r = z.node.getBoundingClientRect();
        const reach = z.opts.reach ?? 32;
        const across = horizontal ? gap(lastY, r.top, r.bottom) : gap(lastX, r.left, r.right);
        const along = horizontal ? gap(lastX, r.left, r.right) : gap(lastY, r.top, r.bottom);
        if (across > 24 || along > reach) continue;
        const score = across * 1e6 + along;
        if (score < bestScore) {
          best = z;
          bestScore = score;
        }
      }
      if (!best) return;
      const others = itemsOf(best.node, draggedSet);
      const rects = others.map((el) => el.getBoundingClientRect());
      const index = dropIndex(
        rects.map((r) => (horizontal ? r.left + r.width / 2 : r.top + r.height / 2)),
        horizontal ? lastX : lastY,
      );
      target = { zone: best, index };
      const zr = best.node.getBoundingClientRect();
      if (horizontal) {
        const x = rects.length === 0 ? zr.left + 2 : index < rects.length ? rects[index].left - 6 : rects[rects.length - 1].right + 4;
        Object.assign(line.style, { display: 'block', left: `${x}px`, top: `${zr.top + 8}px`, width: '2px', height: `${Math.max(24, zr.height - 16)}px` });
      } else {
        const y = rects.length === 0 ? zr.top + 2 : index < rects.length ? rects[index].top - 1 : rects[rects.length - 1].bottom + 1;
        Object.assign(line.style, { display: 'block', left: `${zr.left + 8}px`, top: `${y}px`, width: `${zr.width - 16}px`, height: '2px' });
      }
    };

    // Scroll the page near its top and bottom edges, and a sideways scroller near its left and right edges.
    const tick = () => {
      const edge = 70;
      if (lastY < edge) window.scrollBy(0, -10);
      else if (lastY > window.innerHeight - edge - 60) window.scrollBy(0, 10);
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (lastX < r.left + 40) scroller.scrollLeft -= 12;
        else if (lastX > r.right - 40) scroller.scrollLeft += 12;
      }
      locate();
      raf = requestAnimationFrame(tick);
    };
    place();
    raf = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      lastY = ev.clientY;
      lastX = ev.clientX;
      place();
      locate();
    };
    const finish = (drop: boolean) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      ghost.remove();
      line.remove();
      for (const el of dragged) el.style.opacity = '';
      document.body.style.userSelect = userSelect;
      if (scroller) scroller.style.scrollSnapType = snap;
      // The click that ends a drag isn't a tap on the item.
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      const t = target as { zone: Zone; index: number } | null;
      if (!drop || !t) return;
      const fromIndex = itemsOf(node).indexOf(item);
      if (ids.length === 1 && t.zone === zone && t.index === fromIndex) return;
      t.zone.opts.onDrop({ id, ids, from: zone.opts.zone, to: t.zone.opts.zone, index: t.index });
    };
    const up = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(true);
    const cancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(false);
    const escape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      ev.preventDefault();
      finish(false);
    };
    // On the window, so the drag follows the pointer wherever it goes.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
  }

  function onKeyDown(e: KeyboardEvent) {
    const [back, forward] = zone.opts.axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (e.key !== back && e.key !== forward) return;
    const hit = handleFor(e.target);
    if (!hit || !zone.opts.onKeyMove) return;
    e.preventDefault();
    e.stopPropagation();
    zone.opts.onKeyMove(hit.item.dataset.sortId!, e.key === back ? -1 : 1);
    // Keep the focus on the moved item's handle once the list has re-rendered.
    const id = hit.item.dataset.sortId!;
    setTimeout(() => node.querySelector<HTMLElement>(`[data-sort-id="${CSS.escape(id)}"] [data-drag-handle]`)?.focus(), 50);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('keydown', onKeyDown);
  return {
    update(next: SortableOptions) {
      groups.get(zone.opts.group)?.delete(zone);
      zone.opts = next;
      join();
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('keydown', onKeyDown);
      groups.get(zone.opts.group)?.delete(zone);
    },
  };
}
