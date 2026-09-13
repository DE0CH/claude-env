// Claude OAuth token refresh for the stored credentials (~/.claude/.credentials.json shape:
// {"claudeAiOauth":{accessToken,refreshToken,expiresAt,scopes,subscriptionType,…}}).
// Endpoint + client id are the ones the Claude Code CLI itself uses (read from the binary,
// v2.1.270). Refresh tokens rotate: the response's refresh_token replaces the stored one,
// and the previous one must be considered dead.
const TOKEN_URLS = ["https://platform.claude.com/v1/oauth/token", "https://console.anthropic.com/v1/oauth/token"];
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

function parse(credentialsJson) {
  let d; try { d = JSON.parse(credentialsJson || "{}"); } catch { throw new Error("stored credentials are not JSON"); }
  const o = d.claudeAiOauth;
  if (!o || !o.refreshToken) throw new Error("stored credentials have no OAuth refresh token");
  return { d, o };
}
const expiresAt = (credentialsJson) => { try { return Number(JSON.parse(credentialsJson).claudeAiOauth.expiresAt) || 0; } catch { return 0; } };

async function refresh(credentialsJson) {
  const { d, o } = parse(credentialsJson);
  let lastErr = null;
  for (const url of TOKEN_URLS) {
    let r, text;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "claude-selfhost-portal" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: o.refreshToken, client_id: CLIENT_ID }),
        signal: AbortSignal.timeout(20000),
      });
      text = await r.text();
    } catch (e) { lastErr = new Error(`${url}: ${e.message}`); continue; }
    let j = {}; try { j = JSON.parse(text); } catch {}
    if (r.status === 404 || r.status === 405) { lastErr = new Error(`${url}: HTTP ${r.status}`); continue; } // wrong host, try the next
    if (!r.ok || !j.access_token) {
      const why = j.error_description || j.error || j.message || text.slice(0, 200) || `HTTP ${r.status}`;
      const e = new Error(`refresh rejected (${r.status}): ${why}`); e.rejected = r.status >= 400 && r.status < 500; throw e;
    }
    const now = Date.now();
    d.claudeAiOauth = {
      ...o,
      accessToken: j.access_token,
      refreshToken: j.refresh_token || o.refreshToken,
      expiresAt: now + (Number(j.expires_in) || 3600) * 1000,
      ...(j.scope ? { scopes: String(j.scope).split(/\s+/).filter(Boolean) } : {}),
    };
    return { credentials: JSON.stringify(d), expiresAt: d.claudeAiOauth.expiresAt, via: url };
  }
  throw lastErr || new Error("no token endpoint reachable");
}

module.exports = { refresh, expiresAt };
