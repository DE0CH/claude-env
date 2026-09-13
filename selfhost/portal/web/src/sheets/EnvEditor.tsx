// Secret values never reach the browser: the editor lists key names and lets you set a new
// value (blank = unchanged), delete a key, or add keys. Only the changes are sent.
import { useState } from "react";
import { Button, IconButton, TextArea, TextField } from "@radix-ui/themes";
import { api } from "../api";
import { useStore, refresh } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Muted, Spinner, useBusy } from "../ui";

function parseVal(v: string) { if (v.startsWith('"') && v.endsWith('"')) { try { return JSON.parse(v); } catch {} } return v; }

export function EnvEditor({ name, open, onClose, onClosed }: { name: string; open: boolean; onClose: () => void; onClosed: () => void }) {
  const envs = useStore((s) => s.state.environments) || {};
  const keys = name ? ((envs[name] || {}).keys || []).slice().sort() : [];
  const [id, setId] = useState(name);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [del, setDel] = useState<Set<string>>(new Set());
  const [add, setAdd] = useState("");
  const [busy, run] = useBusy();
  async function save() {
    const nm = id.trim();
    if (!nm) { alert("name required"); return; }
    const secrets: Record<string, any> = {};
    for (const k of keys) { if (del.has(k)) secrets[k] = ""; else if (vals[k]) secrets[k] = parseVal(vals[k]); }
    for (const line of add.split("\n")) {
      const i = line.indexOf("="); if (i < 1) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1);
      if (!v) { alert(`"${k}": empty value (to delete an existing key use its ✕ button)`); return; }
      secrets[k] = parseVal(v);
    }
    if (!Object.keys(secrets).length && name) { onClose(); return; }
    if (del.size && !confirm(`Delete ${[...del].join(", ")} from "${nm}"?`)) return;
    await run("Saving…", async () => {
      try { await api("POST", "api/environments", { name: nm, secrets }); onClose(); await refresh(false); }
      catch (e: any) { alert(e.message); }
    });
  }
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title={name ? "Edit environment" : "New environment"} snap
      left={<Button variant="ghost" onClick={onClose}>Cancel</Button>}
      right={<Button disabled={!!busy} onClick={save}>{busy ? <><Spinner size="1" />{busy}</> : "Save"}</Button>}>
      <Lbl>Environment id</Lbl>
      <TextField.Root id="ev-title" type="text" name="env-id" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={id} readOnly={!!name} placeholder="e.g. default (lowercase, dashes)" onChange={(e) => setId(e.target.value)} />
      {keys.length > 0 && <Lbl>Existing keys — type a new value to update, leave blank to keep</Lbl>}
      {keys.map((k) => { const d = del.has(k); return (
        <div className="evk" key={k} data-k={k} style={{ opacity: d ? .5 : 1 }}>
          <TextField.Root type="password" className="evv" placeholder={`${k}  (unchanged)`} autoComplete="new-password" autoCapitalize="none" spellCheck={false} disabled={d} value={d ? "" : (vals[k] || "")} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} style={{ fontFamily: "var(--code-font-family)" }} />
          {d ? <Button variant="soft" color="gray" size="2" onClick={() => setDel((s) => { const n = new Set(s); n.delete(k); return n; })}>undo</Button>
            : <IconButton variant="soft" color="red" size="2" title={`delete ${k}`} onClick={() => setDel((s) => new Set(s).add(k))}>✕</IconButton>}
        </div>); })}
      <Lbl>Add keys (KEY=VALUE, one per line)</Lbl>
      <TextArea id="ev-add" rows={3} placeholder="NEW_KEY=value" value={add} onChange={(e) => setAdd(e.target.value)} style={{ fontFamily: "var(--code-font-family)" }} />
      <Muted mt="2">Committed to git encrypted (sops), then applied. Values are write-only — the dashboard never shows them. Multi-line values: wrap in JSON quotes ("...\n...").</Muted>
    </Sheet>
  );
}
