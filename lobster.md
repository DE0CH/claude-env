# Discord: the `lobster` bot

There is a Discord bot named **lobster** (Discord username `lobseter`, application/user ID
`1531420155853406228`) that can DM me directly.

- **Token:** stored as `LOBSTER_TOKEN` somewhere in this environment. It's your job to 

## "discord me"

Whenever I say **"discord me"** (or "ping me on discord", "DM me", etc.), send the message as a
Discord DM from the lobster bot — don't ask which bot or channel, and don't substitute another
notification mechanism.

- My Discord account: `de0ch`, ID `686441008862330881`
- My DM channel with lobster: `1531422588247474266`

```bash
curl -s -X POST \
  -H "Authorization: Bot $LOBSTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"MESSAGE HERE"}' \
  https://discord.com/api/v10/channels/1531422588247474266/messages
```

If the DM channel ID ever stops working, re-open it with:

```bash
curl -s -X POST -H "Authorization: Bot $LOBSTER_TOKEN" -H "Content-Type: application/json" \
  -d '{"recipient_id":"686441008862330881"}' \
  https://discord.com/api/v10/users/@me/channels
```

Keep messages short — they land as a phone notification. Prefix long output with a one-line
summary; Discord's per-message limit is 2000 characters, so split or truncate longer content.

Sanity check (sends a test DM — does not print the token):

```bash
curl -s -X POST \
  -H "Authorization: Bot $LOBSTER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"lobster online from the new environment"}' \
  https://discord.com/api/v10/channels/1531422588247474266/messages
```
