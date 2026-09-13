// Re-login runs the real `claude auth login` in the auth broker; the portal relays the URL
// and the pasted code.
import { useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { api } from "../api";
import { refresh } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Muted, Spinner, useBusy } from "../ui";

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
      left={<Button variant="ghost" onClick={onClose}>Cancel</Button>}
      right={<Button disabled={!!busy} onClick={finish}>{busy ? <><Spinner size="1" />{busy}</> : "Finish"}</Button>}>
      <Muted mt="2">1. Open the link and sign in (it shows a code at the end).</Muted>
      <Button asChild mt="2"><a href={url} target="_blank" rel="noopener">Open sign-in page ↗</a></Button>
      <Muted mt="1">{url}</Muted>
      <Lbl>2. Paste the code</Lbl>
      <TextField.Root id="auth-code" type="text" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} placeholder="code#state" value={code} onChange={(e) => setCode(e.target.value)} />
      {msg && <Text as="div" size="2" color="red" mt="2">{msg}</Text>}
    </Sheet>
  );
}
