// One external store for everything the dashboard polls, read from components with
// useSyncExternalStore. Nothing in here is optimistic: cards only change when the server
// reports the new state; in-flight actions show as PENDING labels on their buttons.
import { useSyncExternalStore } from "react";
import { api, type State } from "./api";

export type Tab = "sessions" | "android" | "envs" | "repos" | "settings";
export type AndroidState = { loading: boolean; server: any; err: string | null; screenTs: number };
export type Toast = { id: number; text: string; kind: "info" | "ok" | "error" };
// a pending yes/no question, shown as an action sheet (App renders it); resolve gets the answer
export type Confirm = { title: string; detail?: string; action: string; danger?: boolean; resolve: (ok: boolean) => void };
type Store = {
  state: State; tab: Tab; pending: Map<string, string>; android: AndroidState; toasts: Toast[]; confirm: Confirm | null;
  sizes: { sizes: Record<string, { label: string }>; default: string };
  models: { models: Record<string, { label?: string }>; default: string };
  refreshing: boolean;
};
const S: Store = {
  state: { environments: {}, repos: [], sessions: [], sessionImage: null, flyError: null, hasCreds: true, auth: {} },
  tab: "sessions", pending: new Map(), android: { loading: false, server: null, err: null, screenTs: 0 },
  sizes: { sizes: {}, default: "medium" }, models: { models: {}, default: "claude-opus-4-8" }, refreshing: false, toasts: [], confirm: null,
};
const listeners = new Set<() => void>();
let snap = { ...S };
function emit() { snap = { ...S }; listeners.forEach((l) => l()); }
export function useStore<T>(sel: (s: Store) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sel(snap), () => sel(snap));
}
export const getStore = () => snap;

export function setTab(t: Tab) { S.tab = t; emit(); if (t === "android" && !S.android.server && !S.android.loading) loadAndroid(); }
export function pend(key: string, label: string | null) { label ? S.pending.set(key, label) : S.pending.delete(key); S.pending = new Map(S.pending); emit(); }

// ---- notices: no alert()/confirm() — toasts at the bottom of the screen, questions as sheets ----
let toastSeq = 0;
export function toast(text: string, kind: Toast["kind"] = "info", ms = kind === "error" ? 8000 : 5000) {
  const id = ++toastSeq; S.toasts = [...S.toasts, { id, text, kind }]; emit();
  setTimeout(() => dismissToast(id), ms);
}
export function dismissToast(id: number) { if (S.toasts.some((t) => t.id === id)) { S.toasts = S.toasts.filter((t) => t.id !== id); emit(); } }
/** Ask a yes/no question; resolves true when the action button is tapped, false on Cancel/dismiss. */
export function ask(q: Omit<Confirm, "resolve">): Promise<boolean> {
  S.confirm?.resolve(false);
  return new Promise((resolve) => { S.confirm = { ...q, resolve }; emit(); });
}
export function answer(ok: boolean) { const c = S.confirm; if (!c) return; S.confirm = null; emit(); c.resolve(ok); }

// ---- polling: 15s idle, 2s while something is settling ----------------------------------
let inflight: Promise<void> | null = null, fastUntil = 0;
const SETTLERS: { pred: (s: State) => boolean; until: number }[] = [];
// A refresh while one is already running waits for that one (never skips): callers that just
// changed something rely on the NEXT state they see being post-change.
export function refresh(manual = false): Promise<void> {
  if (inflight) return inflight;
  if (manual) { S.refreshing = true; emit(); }
  inflight = (async () => {
    try { const st = await api<State>("GET", "api/state"); S.state = { ...st, flyError: st.flyError || null }; }
    catch (e: any) { S.state = { ...S.state, flyError: "load failed: " + e.message }; }
    finally { inflight = null; S.refreshing = false; }
    emit();
  })();
  return inflight;
}
// Run an action and keep its button in the pending state until the server CONFIRMS the
// outcome (pred), polling every second up to maxMs — the UI never flips back to the old
// state in between (Fly's list API lags a metadata/state change by a few seconds).
export async function pendUntil(key: string, label: string, action: () => Promise<void>, pred: (s: State) => boolean, maxMs = 30000) {
  pend(key, label);
  try {
    await action();
    const until = Date.now() + maxMs;
    while (Date.now() < until) { await refresh(false); if (pred(S.state)) break; await new Promise((r) => setTimeout(r, 1000)); }
  } catch (e: any) { toast(e.message, "error"); await refresh(false); }
  finally { pend(key, null); }
}
// poll fast until predicate(state) is true or maxMs elapses
export function settle(pred: (s: State) => boolean, maxMs = 90000) { fastUntil = Math.max(fastUntil, Date.now() + maxMs); SETTLERS.push({ pred, until: Date.now() + maxMs }); }
setInterval(async () => {
  const fast = Date.now() < fastUntil, tick = Math.floor(Date.now() / 1000);
  if (fast || tick % 15 === 0) await refresh(false);
  if (S.tab === "android" && (fast || tick % 5 === 0)) loadAndroid();
  for (let i = SETTLERS.length - 1; i >= 0; i--) { const s = SETTLERS[i]; if (s.pred(S.state) || Date.now() > s.until) SETTLERS.splice(i, 1); }
  if (!SETTLERS.length) fastUntil = 0;
}, 2000);

export async function loadAndroid() {
  if (S.android.loading) return; S.android = { ...S.android, loading: true }; emit();
  try { const j = await api("GET", "api/redroid/state"); S.android = { ...S.android, server: j.server, err: j.configured ? null : (j.error || "not configured") }; }
  catch (e: any) { S.android = { ...S.android, err: e.message }; }
  S.android = { ...S.android, loading: false }; emit();
}
export function setAndroid(patch: Partial<AndroidState>) { S.android = { ...S.android, ...patch }; emit(); }

fetch("api/sizes").then((r) => r.json()).then((j) => { S.sizes = j; emit(); }).catch(() => {});
fetch("api/models").then((r) => r.json()).then((j) => { S.models = j; emit(); }).catch(() => {});
refresh(true);

// read hooks for test/dashboard.test.js
(window as any).getState = () => S.state;
(window as any).__refresh = () => refresh(false);
