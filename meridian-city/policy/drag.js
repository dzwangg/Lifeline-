const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// A fixed-position copy of `el`, so it can travel over scrolling, clipped columns.
function floatingCopy(el, rect, className) {
  const copy = el.cloneNode(true);
  copy.classList.add(className);
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('tabindex');
  copy.removeAttribute('data-key');
  copy.removeAttribute('role');
  Object.assign(copy.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(copy);
  return copy;
}

// Animates `el` arriving from `from` (a DOMRect), flying a copy above everything so it is never clipped.
export function flyFrom(el, from, { duration = 420 } = {}) {
  if (!el || !from || reducedMotion()) return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01) return;
  const copy = floatingCopy(el, to, 'pp-flying');
  el.style.opacity = '0';
  copy.animate(
    [{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }],
    { duration, easing: 'cubic-bezier(.22, 1.18, .36, 1)' },
  ).finished.finally(() => {
    copy.remove();
    el.style.opacity = '';
  });
}

// Pointer-driven drag and drop (mouse, pen and touch). Drop targets carry [data-drop].
export function createDrag({ root, handle, scrollers = '', payloadOf, canDrop, onStart, onEnd, onDrop }) {
  let pending = null;
  let drag = null;
  let suppressClick = false;

  root.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    const el = e.target.closest(handle);
    if (!el || e.target.closest('button, input')) return;
    pending = { el, x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  function start(e) {
    const { el } = pending;
    pending = null;
    const payload = payloadOf(el);
    if (!payload) return;
    const rect = el.getBoundingClientRect();
    drag = { el, payload, id: e.pointerId, x: e.clientX, y: e.clientY, over: null, ghost: floatingCopy(el, rect, 'pp-ghost') };
    el.classList.add('is-drag-source');
    document.documentElement.classList.add('pp-dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}
    onStart(payload);
    requestAnimationFrame(autoScroll);
  }

  // Scroll a list when the dragged card nears its top or bottom edge, so off-screen slots stay reachable.
  function autoScroll() {
    if (!drag) return;
    if (drag.px != null) {
      for (const box of root.querySelectorAll(scrollers)) {
        const r = box.getBoundingClientRect();
        if (drag.px < r.left || drag.px > r.right || box.scrollHeight <= box.clientHeight) continue;
        const edge = Math.min(48, r.height / 4);
        const dy = drag.py < r.top + edge ? -(r.top + edge - drag.py) : drag.py > r.bottom - edge ? drag.py - (r.bottom - edge) : 0;
        if (dy && drag.py > r.top - edge && drag.py < r.bottom + edge) box.scrollTop += dy / 3;
      }
    }
    requestAnimationFrame(autoScroll);
  }

  function track(e) {
    drag.px = e.clientX; drag.py = e.clientY;
    drag.ghost.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px) rotate(-3deg) scale(1.06)`;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop]');
    const over = hit && root.contains(hit) && canDrop(drag.payload, hit) ? hit : null;
    if (over === drag.over) return;
    drag.over?.classList.remove('is-over');
    over?.classList.add('is-over');
    drag.over = over;
  }

  function end() {
    drag.el.classList.remove('is-drag-source');
    drag.over?.classList.remove('is-over');
    document.documentElement.classList.remove('pp-dragging');
    drag = null;
    onEnd();
  }

  function finish() {
    const { ghost, over, payload } = drag;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    end();
    if (over) {
      const rect = ghost.getBoundingClientRect();
      ghost.remove();
      onDrop(payload, over, rect);
    } else {
      settleBack(ghost);
    }
  }

  function settleBack(ghost) {
    if (reducedMotion()) return ghost.remove();
    ghost.animate([{ transform: ghost.style.transform }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.3, .7, .3, 1)' })
      .finished.finally(() => ghost.remove());
  }

  function abort() {
    if (!drag) return;
    const { ghost } = drag;
    end();
    settleBack(ghost);
  }

  addEventListener('pointermove', e => {
    if (pending && !drag && e.pointerId === pending.id && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 6) start(e);
    if (drag && e.pointerId === drag.id) track(e);
  });
  addEventListener('pointerup', e => {
    if (drag && e.pointerId === drag.id) finish();
    pending = null;
  });
  addEventListener('pointercancel', () => { pending = null; abort(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) { e.stopPropagation(); e.preventDefault(); abort(); }
  }, true);
  // A drag ends in a click on whatever is under the pointer; swallow it.
  addEventListener('click', e => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);

  return { abort, isActive: () => !!drag };
}
