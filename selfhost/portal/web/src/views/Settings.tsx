import { api, fromNow } from "../api";
import { useStore, pend, refresh } from "../store";
import { PButton } from "../ui";

export function Settings({ onRelogin }: { onRelogin: () => void }) {
  const st = useStore((s) => s.state);
  const c = st.creds || {};
  const exp = c.expiresAt ? new Date(c.expiresAt) : null;
  async function refreshCreds() {
    pend("credrefresh", "Refreshing…");
    try { const r = await api("POST", "api/credentials/refresh"); alert(r.refreshed ? "Token refreshed. Valid until " + new Date(r.expiresAt).toLocaleString() : "Token was still fresh (valid until " + new Date(r.expiresAt).toLocaleString() + ")."); }
    catch (e: any) { alert(e.message); }
    pend("credrefresh", null); await refresh(false);
  }
  return (
    <>
      <div className="card mb-3"><div className="card-body"><h5 className="card-title">Claude account</h5>
        <div className="text-body-secondary small">{st.hasCreds ? <>Signed in{c.subscriptionType ? " · " + c.subscriptionType : ""}{exp ? " · access token " + (exp > new Date() ? "expires " : "expired ") + fromNow(exp) : ""}</> : "Not signed in"}</div>
        {c.stale && <div className="text-danger small">Token refresh rejected: {c.error || ""}</div>}
        <div className="form-text">Runs the real <code>claude auth login</code> on the controller (in the auth-broker pod, which portal rollouts never restart): you open the link, sign in, and paste the code back here.{(st.auth || {}).unavailable && <> <b className="text-danger">Auth broker unreachable</b> — check the auth-broker pod.</>} New sessions use the stored credentials; the portal refreshes them before each start and running sessions push their refreshed copy back.</div>
        <div className="d-flex gap-2 mt-3"><PButton pkey="auth" onClick={onRelogin} label="Re-login" />{st.hasCreds && <PButton pkey="credrefresh" cls="btn-outline-secondary" onClick={refreshCreds} label="Refresh token" />}</div>
      </div></div>
      <div className="card mb-3"><div className="card-body"><h5 className="card-title">Session image</h5>
        <div className="text-body-secondary small text-break">{st.sessionImage || "none pinned yet"}</div>
        <div className="form-text">Built by GitHub Actions (<code>session-image</code> workflow) on every push that touches <code>selfhost/session-image/</code>, pushed to the public package <code>ghcr.io/de0ch/claude-sessions</code> and pinned into <code>selfhost/k8s/config/portal-config.yaml</code>; Flux applies the ref within a minute and the next session boots from it. To rebuild without a code change, re-run the workflow on GitHub. Nothing builds inside the portal, so rollouts can't lose a build.</div>
        <div className="mt-3"><a className="btn btn-outline-secondary btn-sm" href="https://github.com/DE0CH/claude-env/actions/workflows/session-image.yml" target="_blank" rel="noopener">Workflow runs ↗</a></div>
      </div></div>
      <div className="card mb-3"><div className="card-body"><h5 className="card-title">Controller</h5>
        <div className="text-body-secondary small">portal v{st.version || "?"} · Fly app {st.flyApp || ""}</div>
        <div className="form-text">Everything here is reconciled by Flux from the claude-env repo (selfhost/k8s). Edits made in this dashboard are committed back to git (secrets encrypted with sops) and applied immediately.</div>
      </div></div>
    </>
  );
}
