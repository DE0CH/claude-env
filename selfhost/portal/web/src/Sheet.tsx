// Our own bottom sheet (no library): iOS detents with the real iOS motion model — see
// sheet/physics.ts (spring with bounce 0 / 0.5 s, velocity projection, rubber band, an
// accelerating no-ease-out dismiss) and
// sheet/useSheet.ts (gesture hand-off, keyboard, animation loop). Chrome is Radix Themes.
//
// Hand-off rules (what iOS does): below the top detent the content never scrolls, so any drag
// on it moves the sheet — a flick up expands. At the top detent the content scrolls; a drag
// down while it is scrolled to the top brings the sheet down instead. Focusing a field snaps to
// full so the keyboard and the scroller never fight. Panel is sized to the VISUAL viewport, so
// the keyboard shrinks it and the focused field stays reachable.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Heading, Text, Flex, Box, Separator } from "@radix-ui/themes";
import { useSheet } from "./sheet/useSheet";
import { syncStatusBar } from "./statusBar";

const SNAP = [0.62, 1], CONTENT = [1];

function useVisualViewport() {
  const read = () => { const v = window.visualViewport; return v ? { top: Math.round(v.offsetTop), height: Math.round(v.height) } : { top: 0, height: window.innerHeight }; };
  const [vv, setVv] = useState(read);
  useEffect(() => {
    const v = window.visualViewport; const on = () => setVv(read());
    v?.addEventListener("resize", on); v?.addEventListener("scroll", on); window.addEventListener("resize", on);
    return () => { v?.removeEventListener("resize", on); v?.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return vv;
}

type SheetProps = { open: boolean; onClose: () => void; title?: string; left?: ReactNode; right?: ReactNode; snap?: boolean; children: ReactNode; onClosed?: () => void; className?: string };

// Mounts the panel only while a sheet is open or animating closed; each open gets a fresh panel
// (keyed), so a sheet component may stay mounted with open=false without leaving anything behind.
export function Sheet(props: SheetProps) {
  const [live, setLive] = useState(props.open);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => { if (props.open && !live) { setLive(true); setEpoch((e) => e + 1); } }, [props.open]);
  if (!live) return null;
  return <SheetPanel key={epoch} {...props} onClosed={() => { setLive(false); props.onClosed?.(); }} />;
}

function SheetPanel({ open, onClose, title, left, right, snap, children, onClosed, className }: SheetProps) {
  const panel = useRef<HTMLDivElement>(null), backdrop = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null);
  const vv = useVisualViewport();
  const s = useSheet({ open, onClose, onClosed, detents: snap ? SNAP : CONTENT, initial: 0, panel, backdrop, scroller });
  // nothing behind the sheet scrolls; Escape closes; the browser's status-bar strip dims with the
  // overlay (and lightens again once the panel is gone from the DOM)
  useEffect(() => {
    const prev = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") s.close(); };
    window.addEventListener("keydown", key);
    syncStatusBar();
    return () => { document.documentElement.style.overflow = prev; window.removeEventListener("keydown", key); requestAnimationFrame(syncStatusBar); };
  }, []);
  // the content scrolls at the full detent (already while the sheet is on its way there: the
  // browser fixes touch-action at touch start, so a scroll right after the snap must find it set)
  const scrollable = s.isFull;
  return (
    <div className="sheet-vp" style={{ top: vv.top, height: vv.height }}>
      <div ref={backdrop} className="sheet-overlay" onClick={() => s.close()} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title || "Menu"} className={`sheet${snap ? " snap" : ""}${className ? " " + className : ""}`}>
        <div className="handle-wrap"><div className="handle" /></div>
        {title !== undefined && (
          <div className="head">
            <div className="side">{left}</div>
            <Heading as="h2" size="3" className="ttl">{title}</Heading>
            <div className="side r">{right}</div>
          </div>
        )}
        <div ref={scroller} className="body" style={{ overflowY: scrollable ? "auto" : "hidden", touchAction: scrollable ? "pan-y" : "none" }}>
          <div className="body-in">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Action sheet: a list of actions + Cancel.
export type MenuItem = { label: string; sub?: string; danger?: boolean; disabled?: boolean; onClick: () => void };
export function ActionSheet({ open, onClose, onClosed, title, message, items }: { open: boolean; onClose: () => void; onClosed?: () => void; title?: string; message?: ReactNode; items: MenuItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} className="menu-sheet">
      <Box className="menu" pb="2">
        {title && <Text as="div" size="1" color="gray" align="center" mb="2" truncate>{title}</Text>}
        {message && <Text as="div" size="2" align="center" mb="3" className="msg">{message}</Text>}
        <Flex direction="column" mb="3" className="mlist">
          {items.map((it, i) => (
            <Box key={i}>
              {i > 0 && <Separator size="4" />}
              <button type="button" className="mi" disabled={it.disabled} onClick={() => { it.onClick(); onClose(); }}>
                <Text as="div" size="3" weight="medium" color={it.danger ? "red" : undefined}>{it.label}</Text>
                {it.sub && <Text as="div" size="1" color="gray">{it.sub}</Text>}
              </button>
            </Box>
          ))}
        </Flex>
        <Button size="3" variant="soft" color="gray" className="cancel" style={{ width: "100%" }} onClick={onClose}>Cancel</Button>
      </Box>
    </Sheet>
  );
}
