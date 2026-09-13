// Secret values never reach the browser: the editor lists key names and lets you set a new
// value (blank = unchanged), delete a key, or add keys. Only the changes are sent.
import { useState } from "react";
import { api } from "../api";
import { useStore, refresh } from "../store";
import { Sheet } from "../Sheet";
import { Lbl, Spinner, useBusy } from "../ui";

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
      left={<button className="btn btn-link text-decoration-none px-1" onClick={onClose}>Cancel</button>}
      right={<button className="btn btn-primary btn-sm" disabled={!!busy} onClick={save}>{busy ? <><Spinner />{busy}</> : "Save"}</button>}>
      <Lbl>Environment id</Lbl>
      <input id="ev-title" className="form-control" type="text" name="env-id" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={id} readOnly={!!name} placeholder="e.g. default (lowercase, dashes)" onChange={(e) => setId(e.target.value)} />
      {keys.length > 0 && <Lbl>Existing keys — type a new value to update, leave blank to keep</Lbl>}
      {keys.map((k) => { const d = del.has(k); return (
        <div className={`input-group mb-2 evk${d ? " opacity-50" : ""}`} key={k} data-k={k}>
          <input type="password" className="form-control font-monospace evv" placeholder={`${k}  (unchanged)`} autoComplete="new-password" autoCapitalize="none" spellCheck={false} disabled={d} value={d ? "" : (vals[k] || "")} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
          <button className="btn btn-outline-danger" type="button" title={d ? `keep ${k}` : `delete ${k}`} onClick={() => setDel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}>{d ? "undo" : "✕"}</button>
        </div>); })}
      <Lbl>Add keys (KEY=VALUE, one per line)</Lbl>
      <textarea id="ev-add" className="form-control font-monospace" rows={3} placeholder="NEW_KEY=value" value={add} onChange={(e) => setAdd(e.target.value)} />
      <div className="form-text">Committed to git encrypted (sops), then applied. Values are write-only — the dashboard never shows them. Multi-line values: wrap in JSON quotes ("...\n...").</div>
    </Sheet>
  );
}
