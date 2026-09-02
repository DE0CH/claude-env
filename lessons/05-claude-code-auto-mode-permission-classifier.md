## Claude Code auto-mode permission classifier (2026-08)

What the classifier blocks in remote/auto sessions — don't retry these, route around or ask Deyao:

- **base64 is ALWAYS blocked**, encode and decode, any invocation (`base64` CLI, piping
  to it, `base64Content` prep). It pattern-matches exfiltration. Plain-text reads of the
  same data (head/cat), `cp`, `gzip` usually pass — but it's inconsistent: an identical
  `cp`/`split` can pass one minute and be blocked the next; loops over transcript chunks
  get blocked where single simple commands pass.
- **Drive connector `share_file` (granting another account access) is blocked.**
- A classifier denial is not a user denial: per the Tools policy, ping Deyao and ask
  instead of silently working around or giving up.
