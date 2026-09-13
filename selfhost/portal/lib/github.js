// GitHub repo listing for the dashboard's "Add repo" picker. Uses the portal's GITHUB_TOKEN
// (the same PAT gitsync commits with) and lists every repo that token can see — owned,
// collaborator, and org-member — newest push first. Cached in memory for 5 minutes;
// `refresh()` bypasses the cache. Only repo metadata leaves this module, never the token.
const API = "https://api.github.com";
const TTL = 5 * 60 * 1000;
let cache = null; // { at, data }

async function page(n) {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN missing — the portal can't list your GitHub repos");
  const r = await fetch(`${API}/user/repos?per_page=100&page=${n}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`, {
    headers: { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "claude-selfhost-portal" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : []; } catch { json = []; }
  if (!r.ok) throw new Error(`GitHub /user/repos -> ${r.status}: ${(json.message || text).slice(0, 200)}`);
  return json;
}

async function fetchAll() {
  const out = [];
  for (let n = 1; n <= 10; n++) { // 1000 repos is plenty for a personal account
    const items = await page(n);
    for (const it of items) {
      out.push({
        fullName: it.full_name,
        url: it.clone_url || `https://github.com/${it.full_name}.git`,
        htmlUrl: it.html_url,
        private: !!it.private,
        fork: !!it.fork,
        archived: !!it.archived,
        description: it.description || "",
        language: it.language || "",
        pushedAt: it.pushed_at || it.updated_at || null,
        owner: it.owner && it.owner.login,
      });
    }
    if (items.length < 100) break;
  }
  return out;
}

async function list({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < TTL) return { repos: cache.data, cachedAt: cache.at };
  const data = await fetchAll();
  cache = { at: Date.now(), data };
  return { repos: data, cachedAt: cache.at };
}

module.exports = { list };
