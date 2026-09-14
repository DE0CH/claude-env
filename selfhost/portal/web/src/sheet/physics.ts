// Motion model borrowed from iOS (WWDC18 "Designing Fluid Interfaces", WWDC23 "Animate with
// springs"; nathangitter/fluid-interfaces for the reference code):
//  • a spring with bounce 0 ("smooth", critically damped) and perceptual duration 0.5 s —
//    stiffness = (2π/duration)², damping = 4π/duration, mass 1; the default UIKit/SwiftUI spring
//  • the animation starts with the gesture's release velocity, so position AND velocity are
//    continuous across the hand-off (a Bézier curve can't do that)
//  • the destination is chosen by PROJECTING the release velocity with UIScrollView's normal
//    deceleration rate (0.998/ms): where would the finger have coasted to? → nearest detent
//  • dragging past the end rubber-bands with Apple's formula (coefficient 0.55)
//  • motion that does NOT start from a gesture (open, close, snap-to-full on focus) follows the
//    iOS sheet-presentation curve instead: 500 ms on cubic-bezier(0.32, 0.72, 0, 1), as
//    reverse-engineered by the Ionic Framework for its iOS modal and adopted by vaul. Its start
//    is very steep (initial slope 2.25× linear), which is why 500 ms reads as quick — a spring
//    from rest starts with zero velocity and the same half second felt sluggish.

export const DURATION = 0.5;                     // s, perceptual duration of the spring
export const OMEGA = (2 * Math.PI) / DURATION;   // rad/s; critically damped ⇒ ζ = 1
const DECEL = 0.998;                             // UIScrollView.DecelerationRate.normal
export const REVEAL_MS = 500;                    // iOS sheet present/dismiss
const [X1, Y1, X2, Y2] = [0.32, 0.72, 0, 1];     // its easing (Ionic ios.enter/leave)
const bz = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
const bzd = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * a + 6 * (1 - s) * s * (b - a) + 3 * s ** 2 * (1 - b);
/** Reveal-curve progress (0..1) and slope at time fraction `t` — Newton on the x polynomial. */
export function reveal(t: number): { p: number; slope: number } {
  if (t <= 0) return { p: 0, slope: Y1 / X1 };
  if (t >= 1) return { p: 1, slope: 0 };
  let s = t;
  for (let i = 0; i < 8; i++) { const dx = bzd(X1, X2, s); if (dx < 1e-6) break; s = Math.min(1, Math.max(0, s - (bz(X1, X2, s) - t) / dx)); }
  const dx = bzd(X1, X2, s);
  return { p: bz(Y1, Y2, s), slope: dx > 1e-6 ? bzd(Y1, Y2, s) / dx : 0 };
}

/** Distance (px) travelled after decelerating from `v` px/s to rest. */
export const project = (v: number) => (v / 1000) * DECEL / (1 - DECEL);

/** Apple's rubber band: how far the content actually moves when dragged `x` past the edge. */
export const rubberBand = (x: number, dim: number, c = 0.55) => (1 - 1 / ((x * c) / dim + 1)) * dim;

/**
 * Motion to a target: from rest (v0 = 0, i.e. not a gesture release) the timed reveal curve above;
 * with a release velocity, a critically damped spring, closed form. Displacement from the target d(t) = (d0 + (v0 + ω·d0)·t)·e^(−ωt),
 * velocity v(t) = (v0 − ω·(v0 + ω·d0)·t)·e^(−ωt). Retargeting mid-flight starts a new spring from
 * the current position/velocity (velocity preservation).
 */
export class Spring {
  private t0 = 0; private d0 = 0; private v0 = 0; private timed = false; target = 0; running = false;
  start(from: number, to: number, v0: number, now: number) {
    this.target = to; this.d0 = from - to; this.v0 = v0; this.t0 = now; this.running = true; this.timed = v0 === 0;
  }
  /** position + velocity at time `now` (ms) */
  at(now: number): { x: number; v: number; done: boolean } {
    if (this.timed) {
      const f = (now - this.t0) / REVEAL_MS, { p, slope } = reveal(f), done = f >= 1;
      return { x: done ? this.target : this.target + this.d0 * (1 - p), v: done ? 0 : (-this.d0 * slope) / (REVEAL_MS / 1000), done };
    }
    const t = Math.max(0, (now - this.t0) / 1000), e = Math.exp(-OMEGA * t), a = this.v0 + OMEGA * this.d0;
    const d = (this.d0 + a * t) * e, v = (this.v0 - OMEGA * a * t) * e;
    // "settled" = within a hair of the target and practically still, or past the perceptual
    // duration (Apple: completion fires on the perceptual duration, not the theoretical settling
    // time — by then the remaining displacement is sub-pixel)
    const done = (Math.abs(d) < 0.3 && Math.abs(v) < 8) || t >= DURATION * 1.2;
    return { x: done ? this.target : this.target + d, v: done ? 0 : v, done };
  }
}

/** Velocity estimate from the last ~100 ms of pointer samples (px/s). */
export class VelocityTracker {
  private s: { t: number; y: number }[] = [];
  reset() { this.s = []; }
  push(t: number, y: number) { this.s.push({ t, y }); while (this.s.length > 2 && t - this.s[0].t > 100) this.s.shift(); }
  velocity(now: number) {
    if (this.s.length < 2) return 0;
    const a = this.s[0], b = this.s[this.s.length - 1];
    if (now - b.t > 80) return 0;               // finger paused before lifting
    const dt = b.t - a.t; return dt > 0 ? ((b.y - a.y) / dt) * 1000 : 0;
  }
}
