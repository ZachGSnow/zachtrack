// Drag and drop for lists (ARCHITECTURE.md 3.65), as a Svelte action on the
// list element. Its items carry `data-sort-id`; each item's handle carries
// `data-drag-handle`. Dragging starts from the handle only, so the rest of a
// row still scrolls, taps and swipes as usual; the handle has
// `touch-action: none`, so a finger drags it straight away on a phone.
// Lists in the same `group` exchange items (a task dragged into another
// section). Arrow Up and Down on a focused handle move it one place, for the
// keyboard. Written here rather than taken from a library to keep the
// dependencies the licence policy checks to a minimum.

import { dropIndex } from '../utils/reorder';

export interface DropEvent {
  id: string;
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
  /** Arrow Up / Down on a focused handle. */
  onKeyMove?: (id: string, direction: -1 | 1) => void;
}

interface Zone {
  node: HTMLElement;
  opts: SortableOptions;
}

const groups = new Map<string, Set<Zone>>();

const itemsOf = (node: HTMLElement, except?: Element) =>
  [...node.querySelectorAll<HTMLElement>(':scope > [data-sort-id]')].filter((el) => el !== except);

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
    if (!hit) return;
    e.preventDefault();
    startDrag(e, hit.handle, hit.item);
  }

  function startDrag(e: PointerEvent, handle: HTMLElement, item: HTMLElement) {
    const id = item.dataset.sortId!;
    const rect = item.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const ghost = item.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      zIndex: '60',
      pointerEvents: 'none',
      background: 'var(--color-surface)',
      boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
      borderRadius: '0.75rem',
      opacity: '0.95',
    });
    ghost.removeAttribute('data-sort-id');
    ghost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ghost);
    const line = document.createElement('div');
    Object.assign(line.style, { position: 'fixed', height: '2px', background: 'var(--color-brand)', zIndex: '61', pointerEvents: 'none', display: 'none' });
    document.body.appendChild(line);
    item.style.opacity = '0.35';
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Without capture the handle still gets the moves while the pointer is over it.
    }

    let target: { zone: Zone; index: number } | null = null;
    let lastY = e.clientY;
    let lastX = e.clientX;
    let raf = 0;

    const locate = () => {
      const zones = [...(groups.get(zone.opts.group) ?? [])].filter((z) => z.node.isConnected);
      let best: Zone | null = null;
      let bestDistance = Infinity;
      for (const z of zones) {
        const r = z.node.getBoundingClientRect();
        if (lastX < r.left - 24 || lastX > r.right + 24) continue;
        const distance = lastY < r.top ? r.top - lastY : lastY > r.bottom ? lastY - r.bottom : 0;
        if (distance < bestDistance && distance <= 32) {
          best = z;
          bestDistance = distance;
        }
      }
      if (!best) return;
      const others = itemsOf(best.node, item);
      const index = dropIndex(
        others.map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
        lastY,
      );
      target = { zone: best, index };
      const zr = best.node.getBoundingClientRect();
      const y = others.length === 0 ? zr.top + 2 : index < others.length ? others[index].getBoundingClientRect().top - 1 : others[others.length - 1].getBoundingClientRect().bottom + 1;
      Object.assign(line.style, { display: 'block', left: `${zr.left + 8}px`, width: `${zr.width - 16}px`, top: `${y}px` });
    };

    // Scroll the page while the pointer is near the top or bottom edge.
    const tick = () => {
      const edge = 70;
      if (lastY < edge) window.scrollBy(0, -10);
      else if (lastY > window.innerHeight - edge - 60) window.scrollBy(0, 10);
      locate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      lastY = ev.clientY;
      lastX = ev.clientX;
      ghost.style.top = `${ev.clientY - offsetY}px`;
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
      item.style.opacity = '';
      const t = target as { zone: Zone; index: number } | null;
      if (!drop || !t) return;
      const fromIndex = itemsOf(node).indexOf(item);
      if (t.zone === zone && t.index === fromIndex) return;
      t.zone.opts.onDrop({ id, from: zone.opts.zone, to: t.zone.opts.zone, index: t.index });
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
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const hit = handleFor(e.target);
    if (!hit || !zone.opts.onKeyMove) return;
    e.preventDefault();
    zone.opts.onKeyMove(hit.item.dataset.sortId!, e.key === 'ArrowUp' ? -1 : 1);
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
