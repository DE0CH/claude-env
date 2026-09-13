import { useEffect, useRef, useState } from "react";
import { api, ago, type GhRepo } from "../api";
import { useStore, pend, refresh } from "../store";
import { Lbl, PButton, Spinner, useCoolAfterShift } from "../ui";

// ---- GitHub repo picker: search box + dropdown of the repos the portal's token can see ----
let cache: GhRepo[] | null = null;
function Picker({ onPick, disabled }: { onPick: (r: GhRepo) => void; disabled: boolean }) {
  const listed = useStore((s) => s.state.repos);
  const added = new Set((listed || []).map((r) => String(r.url).toLowerCase().replace(/\.git$/, "")));
  const [q, setQ] = useState(""), [open, setOpen] = useState(false), [hi, setHi] = useState(-1);
  const [repos, setRepos] = useState<GhRepo[] | null>(cache), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  async function load(fresh: boolean) {
    if (loading) return; setLoading(true); setError(null);
    try { const j = await api("GET", "api/github/repos" + (fresh ? "?refresh=1" : "")); cache = j.repos || []; setRepos(cache); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }
  useEffect(() => { const h = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", h); return () => document.removeEventListener("pointerdown", h); }, []);
  const all = repos || [], ql = q.trim().toLowerCase(), words = ql.split(/\s+/).filter(Boolean);
  const hit = (r: GhRepo) => words.every((w) => r.fullName.toLowerCase().includes(w) || (r.description || "").toLowerCase().includes(w) || (r.language || "").toLowerCase().includes(w));
  const m = all.filter(hit);
  // exact/prefix matches on the name float up; the API already orders by last push
  const rank = (r: GhRepo) => { const n = r.fullName.toLowerCase(), b = n.split("/")[1] || n; return b === ql ? 0 : b.startsWith(ql) ? 1 : n.includes(ql) ? 2 : 3; };
  if (ql) m.sort((a, b) => rank(a) - rank(b));
  const shown = m.slice(0, 40), hiIdx = Math.min(hi, shown.length - 1);
  const pick = (r: GhRepo) => { onPick(r); setQ(r.fullName); setHi(-1); setOpen(false); };
  const openIt = () => { if (!repos && !loading) load(false); setOpen(true); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { openIt(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hiIdx + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hiIdx - 1, -1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hiIdx >= 0) pick(shown[hiIdx]); else if (shown.length === 1) pick(shown[0]); }
  };
  useEffect(() => { box.current?.querySelector(".it.hi")?.scrollIntoView({ block: "nearest" }); }, [hiIdx]);
  const retry = <a href="#" onClick={(e) => { e.preventDefault(); load(true); }}>refresh list</a>;
  const Tag = ({ t }: { t: string }) => <span className="badge text-bg-light border ms-1 fw-normal">{t}</span>;
  return (
    <div className="dropdown" ref={box}>
      <input id="repo-search" className="form-control" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="Search your GitHub repos…" value={q} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={openIt} onKeyDown={onKey} />
      <div id="repo-dd" className={`dropdown-menu w-100 overflow-auto${open ? " show" : ""}`} style={{ maxHeight: "min(48vh, 22rem)" }} hidden={!open}>
        {loading ? <div className="dropdown-item-text text-body-secondary"><Spinner /> Loading your repos…</div>
          : error ? <div className="dropdown-item-text text-body-secondary">Couldn't list repos: {error} <a href="#" onClick={(e) => { e.preventDefault(); load(true); }}>retry</a></div>
          : <>
            {shown.map((r, i) => { const isAdded = added.has(r.htmlUrl.toLowerCase()); return (
              <button type="button" key={r.fullName} className={`dropdown-item it text-wrap${i === hiIdx ? " active" : ""}`} disabled={isAdded} onPointerDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
                <span className="n fw-semibold">{r.fullName}</span>{r.private && <Tag t="private" />}{r.fork && <Tag t="fork" />}{r.archived && <Tag t="archived" />}{isAdded && <Tag t="added" />}
                <small className="d-block text-body-secondary text-truncate">{r.description || ""}{r.description ? " · " : ""}{r.language ? r.language + " · " : ""}pushed {r.pushedAt ? ago(r.pushedAt) : "?"}</small>
              </button>); })}
            {m.length > 40 && <div className="dropdown-item-text text-body-secondary small">{m.length - 40} more — keep typing to narrow down</div>}
            {!m.length ? <div className="dropdown-item-text text-body-secondary small">{all.length ? "No match." : "No repos visible to the portal's token."} {retry}</div> : <div className="dropdown-item-text text-body-secondary small">{all.length} repos · {retry}</div>}
          </>}
      </div>
    </div>
  );
}

export function Repos() {
  const repos = useStore((s) => s.state.repos) || [];
  const pending = useStore((s) => s.pending);
  const cool = useCoolAfterShift(repos.map((x) => x.name).sort().join("|"));
  // controlled inputs: typed text and an open picker survive the poll-driven re-renders
  const [url, setUrl] = useState(""), [alias, setAlias] = useState(""), [ph, setPh] = useState("auto from URL");
  const busy = pending.has("repo:add");
  async function del(n: string) {
    if (!confirm(`Remove "${n}" from this list?\n\nThis only forgets the entry on the dashboard — nothing on GitHub is deleted or changed.`)) return;
    pend("repo:" + n, "Removing…");
    try { await api("DELETE", "api/repos/" + encodeURIComponent(n)); } catch (e: any) { alert(e.message); }
    pend("repo:" + n, null); await refresh(false);
  }
  async function add() {
    if (!url.trim()) { alert("url required"); return; }
    pend("repo:add", "Adding…");
    try { await api("POST", "api/repos", { url: url.trim(), name: alias.trim() }); setUrl(""); setAlias(""); setPh("auto from URL"); }
    catch (e: any) { alert(e.message); }
    pend("repo:add", null); await refresh(false);
  }
  return (
    <>
      {repos.length ? repos.map((x) => (
        <div className={`card mb-3${pending.has("repo:" + x.name) ? " opacity-75" : ""}`} key={x.name}><div className="card-body">
          <div className="d-flex justify-content-between align-items-start gap-2"><h5 className="card-title mb-0">{x.name}</h5><PButton pkey={"repo:" + x.name} cls="btn-outline-secondary" onClick={() => del(x.name)} label="Remove" cool={cool} /></div>
          <div className="text-body-secondary small text-break">{x.url}</div>
        </div></div>)) : <div className="text-center text-body-secondary py-4">No repos yet.</div>}
      <div className="card" id="repo-add"><div className="card-body">
        <Lbl>Add repo — pick one of yours</Lbl>
        <Picker disabled={busy} onPick={(r) => { setUrl(r.url); setPh(r.fullName.split("/")[1]); }} />
        <Lbl>Git URL (any host)</Lbl>
        <input id="repo-url" className="form-control" type="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://github.com/owner/repo.git" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
        <Lbl>Alias (optional)</Lbl>
        <input id="repo-title" className="form-control" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={ph} value={alias} disabled={busy} onChange={(e) => setAlias(e.target.value)} />
        <div className="mt-3"><PButton pkey="repo:add" onClick={add} label="Add repo" /></div>
        <div className="form-text">The picker lists every repo the portal's GitHub token can see. Private repos also need a GITHUB_TOKEN key in the environment you'll use.</div>
      </div></div>
    </>
  );
}
