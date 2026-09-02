## Waiting on external events (live chats, OTPs, slow pages) (2026-08)

- **Never poll inside a single long foreground Bash loop** — the agent gets no turn
  until the command exits, so it cannot react mid-loop (a live-chat agent asked a
  question and closed the chat for inactivity while a 8-min poll loop was running).
  Instead run the poll loop as a `run_in_background` command that **exits as soon as
  the awaited change appears** — the exit wakes the agent with a turn to respond.
- **Always arm a timed deadman alarm alongside any background wait** (`send_later`,
  ~10 min) in case the background task itself hangs; on firing, check the task
  output, the watched resource, and re-arm both if still waiting.
- Watch DOM text (`browse eval` on the chat iframe's `innerText` length), not
  accessibility snapshots — snapshot re-renders shuffle refs and produce false
  diffs.
