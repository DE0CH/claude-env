import { useState } from "react";
import { api } from "./api";
import { useStore, setTab, refresh, pend, type Tab } from "./store";
import { Sessions } from "./views/Sessions";
import { Android } from "./views/Android";
import { Envs } from "./views/Envs";
import { Repos } from "./views/Repos";
import { Settings } from "./views/Settings";
import { NewSession } from "./sheets/NewSession";
import { EnvEditor } from "./sheets/EnvEditor";
import { Relogin } from "./sheets/Relogin";
import { TerminalSheet } from "./Terminal";

type SheetSpec = { kind: "new" } | { kind: "env"; name: string } | { kind: "relogin"; url: string } | { kind: "term"; id: string; title: string };
const TABS: [Tab, string][] = [["sessions", "Sessions"], ["android", "Android"], ["envs", "Envs"], ["repos", "Repos"], ["settings", "Settings"]];

function Banners() {
  const st = useStore((s) => s.state);
  return (
    <div id="banners">
      {st.hasCreds === false ? <div className="alert alert-danger py-2">No Claude credentials — sessions can't authenticate. Re-login from Settings.</div>
        : (st.creds || {}).stale ? <div className="alert alert-danger py-2">Claude login expired and the token refresh was rejected — new sessions can't sign in. Re-login from Settings.</div> : null}
      {!st.sessionImage && <div className="alert alert-warning py-2">No session image pinned yet — run the session-image workflow on GitHub (see Settings).</div>}
      {st.flyError && <div className="alert alert-danger py-2">Fly: {st.flyError}</div>}
    </div>
  );
}

export function App() {
  const tab = useStore((s) => s.tab);
  const refreshing = useStore((s) => s.refreshing);
  // one sheet at a time; `open` flips false first so vaul can play its exit animation, then
  // onClosed unmounts it
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [open, setOpen] = useState(false);
  const show = (s: SheetSpec) => { setSheet(s); setOpen(true); };
  const close = () => setOpen(false);
  const closed = () => setSheet(null);
  async function relogin() {
    pend("auth", "Starting…");
    try { const { url } = await api("POST", "api/auth/start"); pend("auth", null); show({ kind: "relogin", url }); }
    catch (e: any) { pend("auth", null); alert("Could not start login: " + e.message); }
  }
  return (
    <>
      <nav className="navbar bg-body-tertiary border-bottom sticky-top" style={{ paddingTop: "max(.5rem, env(safe-area-inset-top))" }}>
        <div className="container-fluid wrap">
          <span className="navbar-brand mb-0 h1">Claude sessions</span>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary btn-sm" id="refreshBtn" onClick={() => refresh(true)} aria-label="Refresh" disabled={refreshing}>
              {refreshing ? <span className="spinner-border spinner-border-sm" /> : "↻"}
            </button>
            {tab === "sessions" && <button className="btn btn-primary btn-sm" id="newBtn" onClick={() => show({ kind: "new" })}>+ New session</button>}
          </div>
        </div>
      </nav>
      <div className="container-fluid wrap py-3">
        <Banners />
        <ul className="nav nav-tabs nav-fill mb-3">{TABS.map(([k, l]) => <li className="nav-item" key={k}><button id={"t-" + k} className={`nav-link${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{l}</button></li>)}</ul>
        <div id={"view-" + tab}>
          {tab === "sessions" && <Sessions onTerminal={(id, title) => show({ kind: "term", id, title })} />}
          {tab === "android" && <Android />}
          {tab === "envs" && <Envs onEdit={(name) => show({ kind: "env", name })} />}
          {tab === "repos" && <Repos />}
          {tab === "settings" && <Settings onRelogin={relogin} />}
        </div>
      </div>
      {sheet?.kind === "new" && <NewSession open={open} onClose={close} onClosed={closed} />}
      {sheet?.kind === "env" && <EnvEditor name={sheet.name} open={open} onClose={close} onClosed={closed} />}
      {sheet?.kind === "relogin" && <Relogin url={sheet.url} open={open} onClose={close} onClosed={closed} />}
      {sheet?.kind === "term" && <TerminalSheet session={sheet} open={open} onClose={close} onClosed={closed} />}
    </>
  );
}
