// Live terminal: a tmux mirror of the session (lib/tty.js) — one snapshot per second over the
// API, keystrokes forwarded as tmux send-keys. xterm.js renders the frame.
//
// Layout: a full-screen vaul drawer (drag the handle down to dismiss) whose box is sized to the
// VISUAL viewport, not the layout viewport — on iOS Safari the software keyboard shrinks only
// the former, so a plain fixed/100dvh panel keeps its input row hidden under the keys. Any
// change of the terminal area (open, rotation, keyboard) refits xterm and resizes the remote
// tmux window to match, so the session is always rendered at the size you can actually see.
import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "./api";

function useVisualViewport() {
  const read = () => { const v = window.visualViewport; return v ? { top: Math.round(v.offsetTop), height: Math.round(v.height), kb: window.innerHeight - v.height > 120 } : { top: 0, height: window.innerHeight, kb: false }; };
  const [vv, setVv] = useState(read);
  useEffect(() => {
    const v = window.visualViewport; const on = () => setVv(read());
    v?.addEventListener("resize", on); v?.addEventListener("scroll", on); window.addEventListener("resize", on);
    return () => { v?.removeEventListener("resize", on); v?.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return vv;
}

const KEYS: [string, string][] = [["Enter", "Enter"], ["Esc", "Escape"], ["Tab", "Tab"], ["⇧Tab", "S-Tab"], ["↑", "Up"], ["↓", "Down"], ["←", "Left"], ["→", "Right"], ["⌫", "BSpace"], ["^C", "C-c"], ["^D", "C-d"], ["^L", "C-l"], ["^U", "C-u"]];

export function TerminalSheet({ session, open, onClose, onClosed }: { session: { id: string; title: string }; open: boolean; onClose: () => void; onClosed: () => void }) {
  const vv = useVisualViewport();
  const [screen, setScreen] = useState<HTMLDivElement | null>(null); // callback ref: set once the drawer content is mounted
  const term = useRef<{ t: XTerm; fit: FitAddon } | null>(null);
  const [status, setStatus] = useState("connecting…");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = session.id;

  async function send(body: { text?: string; keys?: string[] }) {
    try { await api("POST", `api/sessions/${id}/tty/input`, body); } catch (e: any) { setStatus(e.message); }
  }
  function sendText() { const t = text; setText(""); send(t ? { text: t, keys: ["Enter"] } : { keys: ["Enter"] }); }

  useEffect(() => {
    if (!screen) return;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const t = new XTerm({ cursorBlink: true, fontSize: coarse ? 12 : 13, convertEol: false, scrollback: 0, theme: { background: "#0b0d11" }, allowProposedApi: true, disableStdin: coarse });
    const fit = new FitAddon(); t.loadAddon(fit); t.open(screen); term.current = { t, fit };
    // desktop keyboard: translate xterm input into tmux keys
    t.onData((data) => {
      const map: Record<string, string> = { "\r": "Enter", "\x7f": "BSpace", "\x1b": "Escape", "\x03": "C-c", "\t": "Tab", "\x1b[A": "Up", "\x1b[B": "Down", "\x1b[C": "Right", "\x1b[D": "Left", "\x1b[Z": "S-Tab", "\x04": "C-d", "\x0c": "C-l", "\x15": "C-u" };
      if (map[data]) send({ keys: [map[data]] }); else if (!data.startsWith("\x1b")) send({ text: data });
    });
    // ---- auto-fit: whenever the terminal area changes size, refit + resize the remote tmux
    let wanted: { cols: number; rows: number; at: number } | null = null, timer: any = null;
    const refit = () => {
      const d = fit.proposeDimensions(); if (!d || !d.cols || !d.rows) return;
      const cols = Math.max(40, Math.min(300, d.cols)), rows = Math.max(10, Math.min(120, d.rows));
      if (t.cols !== cols || t.rows !== rows) t.resize(cols, rows);
      if (wanted && wanted.cols === cols && wanted.rows === rows) return;
      wanted = { cols, rows, at: Date.now() };
      clearTimeout(timer);
      timer = setTimeout(() => api("POST", `api/sessions/${id}/tty/resize`, { cols, rows }).catch((e) => setStatus(e.message)), 250);
    };
    const ro = new ResizeObserver(() => refit());
    ro.observe(screen);
    // fonts may still be loading at mount: measure again once they are
    (document as any).fonts?.ready?.then(() => refit());
    refit();
    // ---- poll one snapshot per second (only repaint when it changed); SSE doesn't survive the tunnel relay
    let last = "", alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const f = await api("GET", `api/sessions/${id}/tty/frame`);
        if (!alive) return;
        const key = f.screen + "|" + f.x + "," + f.y + "," + f.cols + "," + f.rows;
        if (key === last) return; last = key;
        // right after we asked tmux for a new size, frames still carry the old one for a moment —
        // keep xterm at the fitted size instead of flapping back
        const fresh = wanted && Date.now() - wanted.at < 6000 && (wanted.cols !== f.cols || wanted.rows !== f.rows);
        if (!fresh && (t.cols !== f.cols || t.rows !== f.rows)) t.resize(f.cols, f.rows);
        t.write("\x1b[H\x1b[2J" + String(f.screen).replace(/\n/g, "\r\n") + `\x1b[${(f.y | 0) + 1};${(f.x | 0) + 1}H`);
        setStatus(`live · ${f.cols}×${f.rows}`);
      } catch (e: any) { setStatus(e.message); }
    };
    tick(); const iv = setInterval(tick, 1000);
    // nothing behind the terminal should scroll while it is up
    const prev = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    return () => { alive = false; clearInterval(iv); clearTimeout(timer); ro.disconnect(); t.dispose(); term.current = null; document.documentElement.style.overflow = prev; };
  }, [id, screen]);

  // key chips must not steal focus from the input (that would drop the keyboard on iOS)
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }} onAnimationEnd={(o) => { if (!o) onClosed(); }} handleOnly repositionInputs={false} autoFocus={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-overlay" style={{ zIndex: 30 }} />
        <Drawer.Content className={`term${vv.kb ? " kb" : ""}`} style={{ top: vv.top, height: vv.height }} aria-describedby={undefined}>
          <div className="thandle"><Drawer.Handle className="handle" /></div>
          <div className="bar">
            <Drawer.Title className="title">{session.title}</Drawer.Title>
            <span className="status" id="term-status">{status}</span>
            <button className="btn btn-dark btn-sm border-secondary" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="screen"><div id="term" ref={setScreen} style={{ height: "100%" }} /></div>
          <div className="keys">
            {KEYS.map(([l, k]) => <button key={k} className="btn btn-dark btn-sm border-secondary" onPointerDown={keep} onClick={() => send({ keys: [k] })}>{l}</button>)}
          </div>
          <div className="inrow input-group input-group-sm">
            <input ref={input} id="term-in" className="form-control" type="text" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="send" placeholder="type, then Send (adds Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendText(); } }} />
            <button className="btn btn-dark border-secondary" onPointerDown={keep} onClick={sendText}>Send</button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
