// Thin JSON client for the portal API. Paths are RELATIVE ("api/state") because the dashboard is
// served under a prefix through the cf-tunnel (/t/portal/) — never start a path with "/".
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j as T;
}

export type Session = {
  id: string; name: string; state: string; status?: string; bgTasks?: number; created?: string; region?: string;
  environment?: string; repos?: string; permissionMode?: string; model?: string; label?: string; liveName?: string;
  nameSource?: string; aiTitle?: string; guest?: string;
};
export type State = {
  environments: Record<string, { keys?: string[] }>;
  repos: { name: string; url: string }[];
  sessions: Session[];
  sessionImage: string | null;
  flyError: string | null;
  hasCreds: boolean;
  creds?: { stale?: boolean; error?: string; expiresAt?: string; subscriptionType?: string };
  auth?: { unavailable?: boolean };
  version?: string; flyApp?: string;
};
export type GhRepo = { fullName: string; url: string; htmlUrl: string; description?: string; language?: string; private?: boolean; fork?: boolean; archived?: boolean; pushedAt?: string };

export const REGION: Record<string, string> = { arn: "Stockholm", fra: "Frankfurt", ams: "Amsterdam", lhr: "London", cdg: "Paris", waw: "Warsaw", mad: "Madrid", iad: "Virginia", ord: "Chicago", sjc: "San Jose", lax: "Los Angeles", sin: "Singapore", nrt: "Tokyo", hkg: "Hong Kong", syd: "Sydney" };
export function ago(iso: string | Date) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago";
}
// what the Claude app shows: a name you pinned/renamed wins; otherwise the app's AI-generated
// conversation title; until it has booted, the creation name.
export function fromNow(iso: string | Date) { const d = new Date(iso).getTime() - Date.now(); return d < 0 ? ago(iso) : "in " + ago(new Date(Date.now() - d)).replace(" ago", "").replace("just now", "a moment"); }
export function sessionTitle(m: Session) {
  return (m.liveName && m.nameSource && m.nameSource !== "derived") ? m.liveName : (m.aiTitle || m.label || m.liveName || m.name);
}
