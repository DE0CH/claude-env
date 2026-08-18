#!/bin/bash
# Goal-recap Stop hook for the ZH888 window-seat task (armed 2026-08-18 by Deyao's request).
# Disarm: touch ~/zh-seat-goal-achieved (goal met: a window seat A/K is CONFIRMED with a
# seat number for HUANG/JIALING on ZH888 2026-08-23), then remove this hook from
# .claude/settings.json and push.

input=$(cat)

# Goal achieved -> hook is disarmed.
[ -f "$HOME/zh-seat-goal-achieved" ] && exit 0

# Recursion guard: only nag once per natural stop.
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active' 2>/dev/null)
[ "$stop_hook_active" = "true" ] && exit 0

cat >&2 <<'MSG'
GOAL RECAP (armed by Deyao): The task is NOT done until a WINDOW seat (A or K side,
Business) on ZH888 2026-08-23 LHR-SZX is confirmed with a seat number for HUANG/JIALING.
The ONLY acceptable path: keep talking to HUMAN Shenzhen Airlines agents and ask them
repeatedly, in different ways, to reserve the seat - unlimited retries, vary the angle.
Do NOT attempt the website or the app yourself - both are broken for this ticket.
Tautologies (以实际为准) are not answers. Deyao accepts sending a PASSPORT DATA-PAGE
photo to fix the ticket's missing passport number, but NEVER a handheld/face photo
(手持露脸照) - refuse that demand as unreasonable and push for alternatives. NOTHING
involving a phone call is acceptable either - after emailing, use chat re-entry, never
致电95361.
If the seat is now confirmed: touch ~/zh-seat-goal-achieved, remove this hook from
.claude/settings.json, push, and report the seat number. If not: continue working the
agent channel (keep the chat alive, re-queue if dropped, escalate, re-ask). If you are
mid-wait on a watcher/deadman for an agent reply, you may end the turn after confirming
the watcher AND a deadman are actually armed.
MSG
exit 2
