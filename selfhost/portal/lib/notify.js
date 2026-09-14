// Discord DM to Deyao from the `lobster` bot (see lobster.md) — used for things the portal does
// on its own with no session around to say so, e.g. a one-shot session destroyed with unsaved
// work. The bot token comes from the portal env (LOBSTER_TOKEN) or, failing that, from the
// session's environment secrets (the `default` env carries it). Never throws: a failed DM is
// logged, not fatal — the destroy it reports on has already happened.
const DM_CHANNEL = process.env.LOBSTER_DM_CHANNEL || "1531422588247474266";

async function discord(text, { token } = {}) {
  const tok = token || process.env.LOBSTER_TOKEN;
  if (!tok) { console.error("[notify] no LOBSTER_TOKEN available; not sent:", String(text).slice(0, 120)); return false; }
  const content = String(text).slice(0, 1990); // Discord's per-message limit is 2000 chars
  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${DM_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!r.ok) { console.error(`[notify] discord ${r.status}: ${(await r.text()).slice(0, 200)}`); return false; }
    return true;
  } catch (e) { console.error(`[notify] discord failed: ${e.message}`); return false; }
}

module.exports = { discord };
