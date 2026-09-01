#!/usr/bin/env python3
"""Generate a NordVPN WireGuard (NordLynx) config for a given country.

Usage: python3 scripts/nordvpn-wg.py <country_id> [out.conf]
  country_id: NordVPN numeric id (GET /v1/servers/countries; e.g. Singapore=195).

Token source: env NORDVPN_TOKEN, else the newest 64-hex string Deyao DM'd to the
lobster bot. The token and private key are never printed; only the .conf gets them.
"""
import base64, json, os, re, sys, urllib.request, urllib.parse

UA = "Mozilla/5.0"


def get_token():
    t = os.environ.get("NORDVPN_TOKEN", "").strip()
    if t:
        return t
    lob = os.environ.get("LOBSTER_TOKEN")
    if not lob:
        sys.exit("ERROR: no NORDVPN_TOKEN and no LOBSTER_TOKEN to read a DM'd token")
    req = urllib.request.Request(
        "https://discord.com/api/v10/channels/1531422588247474266/messages?limit=15",
        headers={"Authorization": "Bot " + lob, "User-Agent": "DiscordBot (local,1.0)"})
    for m in json.load(urllib.request.urlopen(req, timeout=30)):
        if m.get("author", {}).get("id") == "686441008862330881":
            f = re.search(r"\b[0-9a-fA-F]{64}\b", m.get("content", ""))
            if f:
                return f.group(0)
    sys.exit("ERROR: no NordVPN token in env or recent lobster DMs")


def api(url, token=None):
    h = {"User-Agent": UA}
    if token:
        h["Authorization"] = "Basic " + base64.b64encode(("token:" + token).encode()).decode()
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:
        return json.load(r)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    country_id = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else f"nordvpn-{country_id}.conf"
    token = get_token()

    creds = api("https://api.nordvpn.com/v1/users/services/credentials", token)
    priv = creds.get("nordlynx_private_key")
    if not priv:
        sys.exit("ERROR: no nordlynx_private_key; keys=%s" % list(creds.keys()))
    print("OK: got WireGuard private key (%d chars)" % len(priv))

    q = urllib.parse.urlencode({
        "filters[servers_technologies][identifier]": "wireguard_udp",
        "filters[country_id]": str(country_id),
        "limit": "1",
    })
    servers = api("https://api.nordvpn.com/v1/servers/recommendations?" + q)
    if not servers:
        sys.exit("ERROR: no wireguard server for country_id=%s" % country_id)
    s = servers[0]
    host, name, load = s["hostname"], s["name"], s.get("load")
    pub = next((md["value"] for t in s.get("technologies", [])
                if t.get("identifier") == "wireguard_udp"
                for md in t.get("metadata", []) if md.get("name") == "public_key"), None)
    if not pub:
        sys.exit("ERROR: no server public_key")
    print("Server:   %s (%s)  load=%s%%" % (name, host, load))
    print("PubKey:   %s" % pub)

    conf = (f"[Interface]\nPrivateKey = {priv}\nAddress = 10.5.0.2/32\n"
            f"DNS = 103.86.96.100, 103.86.99.100\n\n[Peer]\nPublicKey = {pub}\n"
            f"AllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = {host}:51820\nPersistentKeepalive = 25\n")
    with open(out, "w") as f:
        f.write(conf)
    os.chmod(out, 0o600)
    print("WROTE:    " + os.path.abspath(out))


if __name__ == "__main__":
    main()
