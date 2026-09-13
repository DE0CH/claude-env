// Re-login runs the real `claude auth login` in the auth broker; the portal relays the URL
// and the pasted code.
import { useState } from "react";
import { api } from "../api";
import { refresh } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Spinner, useBusy } from "../ui";

export function Relogin({ url, open, onClose, onClosed }: { url: string; open: boolean; onClose: () => void; onClosed: () => void }) {
  const [code, setCode] = useState(""), [msg, setMsg] = useState("");
  const [busy, run] = useBusy();
  async function finish() {
    if (!code.trim()) { alert("paste the code first"); return; }
    await run("Signing in…", async () => {
      try { await api("POST", "api/auth/code", { code: code.trim() }); onClose(); await refresh(false); alert("Signed in. New sessions will use the refreshed credentials."); }
      catch (e: any) { setMsg(e.message); }
    });
  }
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title="Re-login to Claude"
      left={<button className="btn btn-link text-decoration-none px-1" onClick={onClose}>Cancel</button>}
      right={<button className="btn btn-primary btn-sm" disabled={!!busy} onClick={finish}>{busy ? <><Spinner />{busy}</> : "Finish"}</button>}>
      <div className="text-body-secondary small mt-2">1. Open the link and sign in (it shows a code at the end).</div>
      <a className="btn btn-primary mt-2" href={url} target="_blank" rel="noopener">Open sign-in page ↗</a>
      <div className="form-text text-break">{url}</div>
      <Lbl>2. Paste the code</Lbl>
      <input id="auth-code" className="form-control" type="text" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} placeholder="code#state" value={code} onChange={(e) => setCode(e.target.value)} />
      {msg && <div className="text-danger small mt-2">{msg}</div>}
    </Sheet>
  );
}
