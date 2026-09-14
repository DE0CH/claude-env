// The gesture + animation engine behind <Sheet>. React owns only the coarse state (which detent
// we are resting at); every frame of motion is written straight to the DOM (transform on the
// panel, opacity on the backdrop) from requestAnimationFrame — no re-render per frame.
//
// Coordinates: y = how far the panel is translated DOWN from its fully-open position, in px.
//   full detent → 0; lower detents → H·(1 − fraction); closed → H (panel height).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { REVEAL_MS, Spring, VelocityTracker, project, rubberBand } from "./physics";

export type Detents = number[];      // fractions of the panel height, ascending, last = 1 (full)

export function useSheet(opts: {
  open: boolean; onClose: () => void; onClosed?: () => void;
  detents: Detents; initial: number;                 // index into detents
  panel: RefObject<HTMLDivElement | null>; backdrop: RefObject<HTMLDivElement | null>; scroller: RefObject<HTMLDivElement | null>;
}) {
  const { open, onClose, onClosed, detents, initial, panel, backdrop, scroller } = opts;
  const [detent, setDetent] = useState(initial);      // resting/target detent (drives overflow rules)
  const st = useRef({
    y: 0, v: 0, closing: false, mounted: false,
    spring: new Spring(), raf: 0, vt: new VelocityTracker(),
    // grabbed: the touch stopped a moving sheet — it always drives the sheet and always settles on release
    drag: null as null | { id: number; y0: number; py0: number; moved: boolean; decided: boolean; native: boolean; grabbed: boolean },
    field: null as HTMLElement | null, revealTimer: 0,   // focused field kept in view (see below)
  }).current;

  const H = () => panel.current ? panel.current.getBoundingClientRect().height : 0;
  const posOf = (i: number) => { const h = H(); return i < 0 ? h : h * (1 - detents[i]); };
  const paint = () => {
    const h = H() || 1;
    if (panel.current) panel.current.style.transform = `translate3d(0,${st.y.toFixed(2)}px,0)`;
    if (backdrop.current) backdrop.current.style.opacity = String(Math.max(0, Math.min(1, 1 - st.y / h)));
  };
  const stopAnim = () => { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; st.spring.running = false; };
  const animateTo = (target: number, v0: number, then?: () => void, dismiss = false) => {
    stopAnim();
    st.spring.start(st.y, target, v0, performance.now(), dismiss);
    const step = (now: number) => {
      const { x, v, done } = st.spring.at(now);
      st.y = x; st.v = v; paint();
      if (done) { st.raf = 0; st.spring.running = false; then?.(); }
      else st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  };
  const snapTo = (i: number, v0 = 0) => {
    if (i < 0) { if (st.closing) return; st.closing = true; animateTo(posOf(-1), v0, () => onClosed?.(), true); onClose(); return; }
    setDetent(i); animateTo(posOf(i), v0);
  };
  /** nearest detent (or closed) to where the finger would have coasted */
  const settle = (v: number) => {
    const projected = st.y + project(v);
    let best = -1, bd = Math.abs(projected - posOf(-1));
    detents.forEach((_, i) => { const d = Math.abs(projected - posOf(i)); if (d < bd) { bd = d; best = i; } });
    // closing needs either a real downward flick or a drag past halfway between the lowest
    // detent and the bottom — a slow, short drag down never dismisses by accident
    if (best === -1 && v < 300 && st.y < posOf(0) + 0.5 * (posOf(-1) - posOf(0))) best = 0;
    snapTo(best, v);
  };

  // ---- open / close ------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!panel.current || st.mounted) return;
    st.mounted = true; st.y = posOf(-1); paint(); snapTo(initial);
  });
  useEffect(() => { if (!open && !st.closing) { st.closing = true; animateTo(posOf(-1), st.v, () => onClosed?.(), true); } }, [open]);
  useEffect(() => () => stopAnim(), []);
  // viewport resize (rotation, keyboard): keep the current detent, re-derive px
  useEffect(() => {
    const on = () => { if (!st.drag && !st.spring.running) { st.y = st.closing ? posOf(-1) : posOf(detent); paint(); } };
    const ro = new ResizeObserver(on); if (panel.current) ro.observe(panel.current);
    return () => ro.disconnect();
  }, [detent]);

  // ---- gestures ---------------------------------------------------------------------------
  useEffect(() => {
    const p = panel.current, sc = scroller.current; if (!p) return;
    const isFull = () => detents[detent] === 1 && !st.spring.running && Math.abs(st.y) < 1;
    // moves/release are tracked on window for the rest of the gesture: a mouse leaves the handle
    // on its first move, and a finger may leave the panel while the sheet lags behind it
    const down = (e: PointerEvent) => {
      if (st.closing || e.button > 0) return;
      const fromScroller = !!sc && sc.contains(e.target as Node);
      // grab a moving sheet: interruptible. Within a hair of its target (the tail of the spring,
      // where a "pull up, then scroll" touch lands) it just completes — the touch is then an
      // ordinary one, so scrolling at full works right away. Further out the gesture takes the
      // sheet over (and settles it on release even without moving, so it can never strand).
      let grabbed = false;
      if (st.spring.running) {
        stopAnim();
        if (Math.abs(st.spring.target - st.y) < 24) { st.y = st.spring.target; st.v = 0; paint(); } else grabbed = true;
      }
      st.drag = { id: e.pointerId, y0: st.y, py0: e.clientY, moved: false, decided: !fromScroller || grabbed, native: false, grabbed };
      st.vt.reset(); st.vt.push(e.timeStamp, st.y);
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    };
    const move = (e: PointerEvent) => {
      const d = st.drag; if (!d || d.native || e.pointerId !== d.id) return;
      const dy = e.clientY - d.py0;
      if (!d.decided) {
        // first movement over the content decides: at the full detent the content scrolls unless
        // it is at the top and the finger moves down; below full there is nothing to scroll, the
        // sheet moves. (touch-action on the scroller mirrors this so the browser agrees.)
        if (Math.abs(dy) < 2) return;
        if (isFull() && !(dy > 0 && sc!.scrollTop <= 0)) { d.native = true; return; }
        d.decided = true;
      }
      if (!d.moved) { if (Math.abs(dy) < 3) return; d.moved = true; }
      let y = d.y0 + dy;
      if (y < 0) y = -rubberBand(-y, H());               // past the top: rubber band
      st.y = y; st.vt.push(e.timeStamp, y); paint();
    };
    const up = (e: PointerEvent) => {
      const d = st.drag; if (!d || e.pointerId !== d.id) return;
      st.drag = null;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (d.native || !(d.moved || d.grabbed)) return;
      settle(st.vt.velocity(e.timeStamp));
    };
    // the browser decides scroll-vs-not on the first touchmove: veto it whenever WE are dragging
    const tm = (e: TouchEvent) => { const d = st.drag; if (d && d.decided && !d.native) e.preventDefault(); };
    p.addEventListener("pointerdown", down);
    p.addEventListener("touchmove", tm, { passive: false });
    return () => { p.removeEventListener("pointerdown", down); p.removeEventListener("touchmove", tm); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [detent, detents]);

  // typing: a focused field wants the keyboard and a scrollable body → go to full first, then
  // keep the field in view for as long as it has focus: once the snap is over, and again every
  // time the scroller changes size — the keyboard shrinks it AFTER focus (iOS: hundreds of ms
  // later), and a shrinking scroller keeps its top and clips its bottom, field included
  useEffect(() => {
    const sc = scroller.current; if (!sc) return;
    // state lives on `st`: the snap changes `detent`, which re-registers this effect mid-flight
    const reveal = () => { const f = st.field; if (f && document.activeElement === f) f.scrollIntoView({ block: "nearest" }); };
    const on = (e: FocusEvent) => {
      const t = e.target as HTMLElement; if (!/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      st.field = t;
      if (detents[detent] !== 1) snapTo(detents.length - 1);
      clearTimeout(st.revealTimer); st.revealTimer = window.setTimeout(reveal, REVEAL_MS + 50);
    };
    const off = () => { st.field = null; };
    const ro = new ResizeObserver(reveal); ro.observe(sc);
    sc.addEventListener("focusin", on); sc.addEventListener("focusout", off);
    return () => { ro.disconnect(); sc.removeEventListener("focusin", on); sc.removeEventListener("focusout", off); };
  }, [detent, detents]);

  return { detent, isFull: detents[detent] === 1, snapTo, close: () => snapTo(-1) };
}
