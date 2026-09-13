import { api } from "../api";
import { useStore, pend, refresh } from "../store";
import { PButton, useCoolAfterShift } from "../ui";

export function Envs({ onEdit }: { onEdit: (name: string) => void }) {
  const envs = useStore((s) => s.state.environments) || {};
  const pending = useStore((s) => s.pending);
  const names = Object.keys(envs).sort();
  const cool = useCoolAfterShift(names.join("|"));
  async function del(n: string) {
    if (!confirm(`Delete environment "${n}" and its saved secret values?\n\nRemoved from the cluster and from git — nothing outside is affected.`)) return;
    pend("env:" + n, "Deleting…");
    try { await api("DELETE", "api/environments/" + encodeURIComponent(n)); } catch (e: any) { alert(e.message); }
    pend("env:" + n, null); await refresh(false);
  }
  return (
    <>
      {names.map((n) => { const d = envs[n]; return (
        <div className={`card mb-3${pending.has("env:" + n) ? " opacity-75" : ""}`} key={n}><div className="card-body">
          <div className="d-flex justify-content-between align-items-start gap-2 mb-1"><h5 className="card-title mb-0">{n}</h5><span className="text-body-secondary small">{(d.keys || []).length} keys</span></div>
          <div className="text-body-secondary small text-break">{(d.keys || []).join(", ") || "—"}</div>
          <div className="d-flex gap-2 mt-3"><button className="btn btn-outline-secondary btn-sm" onClick={() => onEdit(n)}>Edit secrets</button><PButton pkey={"env:" + n} cls="btn-outline-danger" onClick={() => del(n)} label="Delete" cool={cool} /></div>
        </div></div>); })}
      <button className="btn btn-primary" onClick={() => onEdit("")}>+ Add environment</button>
    </>
  );
}
