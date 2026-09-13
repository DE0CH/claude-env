// Android (redroid box): a Hetzner VM managed via HETZNER_API. The only action is Release
// (delete): Hetzner bills a powered-off server exactly like a running one, so a Stop button
// would save nothing. Debug is READ-ONLY: a live screenshot + health pulled over SSH on demand.
import { useState } from "react";
import { api, ago } from "../api";
import { useStore, pend, settle, loadAndroid, setAndroid } from "../store";
import { PButton, Pill, Spinner } from "../ui";

function RdPill({ st }: { st: string }) {
  if (st === "running") return <Pill kind="ok">running</Pill>;
  if (st === "off") return <Pill kind="dim">off</Pill>;
  if (st === "starting" || st === "stopping" || st === "initializing") return <Pill kind="wait"><Spinner />{st}</Pill>;
  return <Pill kind="dim">{st || "unknown"}</Pill>;
}
export function Android() {
  const a = useStore((s) => s.android);
  const [health, setHealth] = useState<any>(null);
  const [note, setNote] = useState<string>("Tap “Load” for a live screenshot and health.");
  const s = a.server;
  if (!s) return <div className="text-center text-body-secondary py-5">{a.loading ? <><Spinner /> Loading…</> : a.err ? `Cloud Android: ${a.err}` : <>No redroid box found.<br />Provision one with <code>redroid/provision.sh</code>.</>}</div>;
  async function release() {
    if (!confirm("Release (DELETE) the cloud-Android box?\n\nThis permanently deletes the VM and everything on it — apps, logins, data. It stops the monthly cost. Rebuild later with redroid/provision.sh. This cannot be undone.")) return;
    pend("rd:release", "Releasing…");
    try { await api("DELETE", "api/redroid"); setAndroid({ server: null, screenTs: 0 }); } catch (e: any) { alert(e.message); }
    pend("rd:release", null); settle(() => !a.server, 30000); await loadAndroid();
  }
  async function debug() {
    pend("rd:debug", "Loading…");
    try { const d = await api("GET", "api/redroid/debug"); setHealth(d.health); setNote(d.health ? "" : (d.note || "no data")); setAndroid({ screenTs: Date.now() }); }
    catch (e: any) { setNote(e.message); }
    pend("rd:debug", null);
  }
  const h = health || {};
  const rows: [string, any][] = [["Boot completed", h.boot === "1" ? "yes" : h.boot], ["Model", h.model], ["Android", h.android], ["redroid", h.redroid === "true" ? "up" : h.redroid], ["Exit IP", h.exitip], ["Proxy", h.proxy], ["Load", h.load], ["Memory", h.mem], ["Disk", h.disk], ["Uptime", h.up]];
  return (
    <>
      <div className="card mb-3"><div className="card-body">
        <div className="d-flex justify-content-between align-items-start gap-2 mb-1"><h5 className="card-title mb-0">Cloud Android</h5><RdPill st={s.status} /></div>
        <div className="text-body-secondary small">{s.type || ""}{s.cores ? ` · ${s.cores} vCPU` : ""}{s.memoryGb ? ` · ${s.memoryGb} GB` : ""}{s.datacenter ? ` · ${s.datacenter}` : ""}<br />{s.ip || "(no IP)"}{s.created ? ` · created ${ago(s.created)}` : ""}</div>
        <div className="mt-3"><PButton pkey="rd:release" cls="btn-outline-danger" onClick={release} label="Release" /></div>
      </div></div>
      {s.status === "running" && (
        <div className="card mb-3"><div className="card-body">
          <div className="d-flex justify-content-between align-items-start gap-2 mb-1"><h5 className="card-title mb-0">Debug — view only</h5><PButton pkey="rd:debug" cls="btn-outline-secondary" onClick={debug} label={a.screenTs ? "Refresh" : "Load"} /></div>
          <div className="text-body-secondary small">{health ? rows.filter((r) => r[1]).map((r) => <div key={r[0]}><b>{r[0]}:</b> {r[1]}</div>) : note}</div>
          {a.screenTs > 0 && <img alt="" className="img-fluid rounded border mt-3" src={"api/redroid/screen.png?t=" + a.screenTs} style={{ maxWidth: 360 }} />}
        </div></div>
      )}
    </>
  );
}
