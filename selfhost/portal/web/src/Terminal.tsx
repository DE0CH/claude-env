// Live terminal: a tmux mirror of the session (lib/tty.js) — one snapshot per second over the
// API, keystrokes forwarded as tmux send-keys. xterm.js renders the frame.
//
// A plain full-screen page (no sheet gestures around xterm): close with ✕ or the browser's
// Back (a history entry is pushed on open). The box is sized to the VISUAL viewport, not the
// layout viewport — on iOS Safari the software keyboard shrinks only the former, so a plain
// fixed/100dvh panel keeps its input row hidden under the keys. Any change of the terminal
// area (open, rotation, keyboard) refits xterm and resizes the remote tmux window to match.
import { useEffect, useState } from "react";
import { Button, Heading, TextField } from "@radix-ui/themes";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "./api";
import { THEME, Theme } from "./theme";
import { syncStatusBar } from "./statusBar";

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

export function TerminalPage({ session, onClose }: { session: { id: string; title: string }; onClose: () => void }) {
  // the browser's status-bar strip takes the bar's colour while the page is up
  useEffect(() => { syncStatusBar(); return () => { requestAnimationFrame(syncStatusBar); }; }, []);
  const vv = useVisualViewport();
  const [screen, setScreen] = useState<HTMLDivElement | null>(null); // callback ref: xterm opens once the element exists
  const [status, setStatus] = useState("connecting…");
  const [text, setText] = useState("");
  const id = session.id;

  async function send(body: { text?: string; keys?: string[] }) {
    try { await api("POST", `api/sessions/${id}/tty/input`, body); } catch (e: any) { setStatus(e.message); }
  }
  function sendText() { const t = text; setText(""); send(t ? { text: t, keys: ["Enter"] } : { keys: ["Enter"] }); }

  // browser Back closes the terminal (one history entry per open)
  useEffect(() => {
    history.pushState({ term: id }, "");
    const pop = () => onClose();
    window.addEventListener("popstate", pop);
    return () => { window.removeEventListener("popstate", pop); if (history.state && history.state.term === id) history.back(); };
  }, [id]);

  useEffect(() => {
    if (!screen) return;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const t = new XTerm({ cursorBlink: true, fontSize: coarse ? 12 : 13, convertEol: false, scrollback: 0, theme: { background: "#0b0d11" }, allowProposedApi: true, disableStdin: coarse });
    const fit = new FitAddon(); t.loadAddon(fit); t.open(screen);
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
    (document as any).fonts?.ready?.then(() => refit()); // fonts may still be loading at mount
    refit();
    // ---- poll one snapshot per second (only repaint when it changed); SSE doesn't survive the tunnel relay
    let last = "", alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const f = await api("GET", `api/sessions/${id}/tty/frame`);
        if (!alive) return;
        const key = f.screen + "|" + f.x + "," + f.y + "," + f.cols + "," + f.rows + "," + f.cursor;
        if (key === last) return; last = key;
        // right after we asked tmux for a new size, frames still carry the old one for a moment —
        // keep xterm at the fitted size instead of flapping back
        const fresh = wanted && Date.now() - wanted.at < 6000 && (wanted.cols !== f.cols || wanted.rows !== f.rows);
        if (!fresh && (t.cols !== f.cols || t.rows !== f.rows)) t.resize(f.cols, f.rows);
        // repaint, park the cursor where tmux says, and show it only if the app shows its own
        t.write("\x1b[?25l\x1b[H\x1b[2J" + String(f.screen).replace(/\n/g, "\r\n") + `\x1b[${(f.y | 0) + 1};${(f.x | 0) + 1}H` + (f.cursor === false ? "" : "\x1b[?25h"));
        setStatus(`live · ${f.cols}×${f.rows}`);
      } catch (e: any) { setStatus(e.message); }
    };
    tick(); const iv = setInterval(tick, 1000);
    // nothing behind the terminal should scroll while it is up
    const prev = document.documentElement.style.overflow; document.documentElement.style.overflow = "hidden";
    return () => { alive = false; clearInterval(iv); clearTimeout(timer); ro.disconnect(); t.dispose(); document.documentElement.style.overflow = prev; };
  }, [id, screen]);

  // key chips must not steal focus from the input (that would drop the keyboard on iOS)
  const keep = (e: React.PointerEvent) => e.preventDefault();
  return (
    <Theme {...THEME} appearance="dark" asChild>
      <div className={`term${vv.kb ? " kb" : ""}`} style={{ top: vv.top, height: vv.height }} role="dialog" aria-label="Terminal">
        <div className="term-in">
          <div className="bar">
            <Heading as="h2" size="3" className="title">{session.title}</Heading>
            <span className="status" id="term-status">{status}</span>
            <Button variant="soft" color="gray" size="1" onClick={onClose} aria-label="Close">✕</Button>
          </div>
          <div className="screen"><div id="term" ref={setScreen} style={{ height: "100%" }} /></div>
          <div className="keys">
            {KEYS.map(([l, k]) => <Button key={k} variant="soft" color="gray" size="1" onPointerDown={keep} onClick={() => send({ keys: [k] })}>{l}</Button>)}
          </div>
          <div className="inrow">
            <TextField.Root id="term-in" size="2" type="text" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="send" placeholder="type, then Send (adds Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendText(); } }} />
            <Button variant="soft" color="gray" size="2" onPointerDown={keep} onClick={sendText}>Send</Button>
          </div>
        </div>
      </div>
    </Theme>
  );
}
