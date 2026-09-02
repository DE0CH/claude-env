## Tunnels from Claude-on-the-web containers (2026-08)

The Anthropic egress gateway (`Egress Gateway SDS Issuing CA` in the cert chain)
MITMs ALL outbound TLS — even with `HTTPS_PROXY`/`https_proxy` unset, interception
is transparent — and only relays traffic that is HTTP(S) or WebSocket on port 443.
Tested results (don't re-derive):

- **ngrok**: dead on any plan. With proxy env set → `ERR_NGROK_9009`
  (agent-behind-proxy = paid feature); with it unset + `root_cas: host` +
  `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` the TLS handshake succeeds but the
  session dies ("session closed") because muxado-inside-TLS isn't HTTP.
- **cloudflared quick tunnel**: registers a URL but edge connections dial port
  7844 (QUIC + TCP both blocked) → Cloudflare error 1033.
- **tunnelmole**: endpoint is `wss://service.tunnelmole.com:8083`; non-443
  CONNECTs return "200 Connection Established" but the stream is reset on first
  TLS bytes. (The 200 is a lie — check `$HTTPS_PROXY/__agentproxy/status`.)
- **devtunnel**: GitHub device-code login gets 403 through the gateway.
- **WebSocket upgrade on 443 works** (verified 101 vs echo.websocket.org), so a
  WSS-on-443 tunnel service would work if one turns up.
- **piping-server (ppng.io) works** both directions — good enough for one-shot
  data relay (see ngrok.md fallbacks).
- Go binaries don't trust the MITM CA by default: set
  `SSL_CERT_FILE=/root/.ccr/ca-bundle.crt` (Node already gets
  `NODE_EXTRA_CA_CERTS`).
