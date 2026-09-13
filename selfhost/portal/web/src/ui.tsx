import { useEffect, useRef, useState } from "react";
import { Badge, Button, Spinner, Text } from "@radix-ui/themes";
import { useStore } from "./store";

export { Spinner };

type BtnColor = "blue" | "gray" | "red" | "green";
type BtnVariant = "solid" | "soft" | "surface" | "outline" | "ghost";
// A button tied to a pending-action key: shows the in-flight label (disabled, spinner) while the
// action runs; `cool` renders it inert + faded (layout-shift guard, see useCoolAfterShift).
export function PButton({ pkey, onClick, label, cool, id, color, variant = "solid", size = "2" }: { pkey: string; onClick: () => void; label: string; cool?: boolean; id?: string; color?: BtnColor; variant?: BtnVariant; size?: "1" | "2" | "3" }) {
  const p = useStore((s) => s.pending.get(pkey));
  if (p) return <Button size={size} color={color} variant={variant} disabled id={id}><Spinner size="1" />{p}</Button>;
  return <Button size={size} color={color} variant={variant} className={cool ? "cool" : undefined} disabled={cool} onClick={onClick} id={id}>{label}</Button>;
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
  const color = { ok: "green", dim: "gray", wait: "amber", bad: "red" }[kind] as "green" | "gray" | "amber" | "red";
  return <Badge color={color} size="1" style={{ textTransform: "uppercase", letterSpacing: ".03em", flex: "none" }}>{children}</Badge>;
}
// section label inside forms
export const Lbl = ({ children }: { children: React.ReactNode }) => <Text as="div" size="1" weight="bold" color="gray" mt="4" mb="2" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>{children}</Text>;
// muted secondary line
export const Muted = ({ children, mt }: { children: React.ReactNode; mt?: "1" | "2" | "3" }) => <Text as="div" size="2" color="gray" mt={mt} style={{ wordBreak: "break-word" }}>{children}</Text>;
