## Serving a file download to Deyao's phone via cf-tunnel (2026-08-29, follow-up)

The first attempt at the 76MB mp4 link "just stuck loading" on the phone for two
reasons on top of the WS-message-size fix above:
- **content-server.py served unknown extensions as text/html** — .mp4 wasn't in its
  content-type map, so the phone browser tried to render 76MB of video bytes as a
  page. Media/zip types now send real MIME types + `Content-Disposition: attachment`
  (force-download; no Range support needed for a download, and the server has none).
- **The tunnel dies whenever the container idles** (background processes are killed;
  known lesson) — a download link is only alive while something keeps the session
  warm. Any tunnel-served file handed to Deyao MUST be paired with a send_later
  heartbeat chain (~20 min) that restarts content-server + agent and re-arms, for as
  long as he might click. If a heartbeat finds ~/tunnel-share empty (container
  reclaimed), restore the payload from the task's Storage Box records dir.
- The worker/agent now also do per-chunk ack flow control (worker awaits each write,
  agent caps unacked chunks at 8×512KB), so a slow mobile client throttles the agent
  instead of ballooning Durable Object memory. Verified byte-identical at a
  rate-limited 2MB/s.
