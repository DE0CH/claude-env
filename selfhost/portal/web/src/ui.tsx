import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";

export const Spinner = () => <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />;

// A button tied to a pending-action key: shows the in-flight label (disabled) while the action
// runs; `cool` renders it inert + faded (layout-shift guard, see useCoolAfterShift).
export function PButton({ pkey, cls = "btn-primary", onClick, label, cool, id }: { pkey: string; cls?: string; onClick: () => void; label: string; cool?: boolean; id?: string }) {
  const p = useStore((s) => s.pending.get(pkey));
  if (p) return <button className={`btn btn-sm ${cls}`} disabled id={id}><Spinner />{p}</button>;
  if (cool) return <button className={`btn btn-sm ${cls} cool`} disabled id={id}>{label}</button>;
  return <button className={`btn btn-sm ${cls}`} onClick={onClick} id={id}>{label}</button>;
}

// When a list's items change (e.g. one removed), the remaining destructive buttons move under
// the finger. Keep them inert + faded for 250ms after any composition change.
export function useCoolAfterShift(signature: string) {
  const last = useRef<string | null>(null);
  const [coolUntil, setCoolUntil] = useState(0);
  useEffect(() => {
    if (last.current !== null && last.current !== signature) { setCoolUntil(Date.now() + 250); const t = setTimeout(() => setCoolUntil(0), 270); last.current = signature; return () => clearTimeout(t); }
    last.current = signature;
  }, [signature]);
  return Date.now() < coolUntil;
}

// flip a button into a pending state while an async action runs
export function useBusy(): [string | null, (label: string, fn: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState<string | null>(null);
  return [busy, async (label, fn) => { setBusy(label); try { await fn(); } finally { setBusy(null); } }];
}

export function Pill({ kind, children }: { kind: "ok" | "dim" | "wait" | "bad"; children: React.ReactNode }) {
  const bg = { ok: "text-bg-success", dim: "text-bg-secondary", wait: "text-bg-warning", bad: "text-bg-danger" }[kind];
  return <span className={`badge ${bg} text-uppercase`} style={{ letterSpacing: ".03em" }}>{children}</span>;
}
// section label inside forms
export const Lbl = ({ children }: { children: React.ReactNode }) => <div className="form-label text-body-secondary small fw-semibold text-uppercase mt-3 mb-1" style={{ letterSpacing: ".04em" }}>{children}</div>;
