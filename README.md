# Discord Username Sniper

The Discord Username Sniper is a script that generates usernames in a shape you choose and updates a Discord username using the Discord API. It sends webhook notifications on a successful or failed snipe. The project is organized into multiple files for modularity and maintainability.

## What it does

- Two modes: **hammer** (random names) and **watch** (specific names from a file).
- **Hammer** generates candidates from a pattern: length plus character set, then tries each one.
- **Watch** probes a list of names with the availability endpoint, and claims the first one that frees up.
- Sends `PATCH /api/v9/users/@me` with a candidate and the account password.
- Honors `429` rate limits exactly as the server states them.
- Posts a webhook embed on a hit, on a fatal stop, or on an attempt ceiling.

## Modes

Run `node index.js` and pick from the menu:

```
  pick a mode
  -----------
  1. hammer   - random names, keeps guessing
  2. watch    - specific names from a file
  3. quit
```

**hammer** then asks for a name shape from a second menu.

**watch** reads `names.txt`, one target per line, `#` for comments:

```
oi
kai
nyx   # sleep token
```

Each round it probes every target; when one reads as free it claims it immediately and pings the webhook.

Pattern tokens:

| Token | Meaning | Example output |
|-------|---------|----------------|
| `3l`  | 3 letters, a-z | `jqz` |
| `4l`  | 4 letters, a-z | `xyev` |
| `3c`  | 3 chars, letters + digits | `a4f` |
| `4c`  | 4 chars, letters + digits | `hg3a` |
| `2n`  | 2 digits | `47` |

## Install

```bash
git clone https://github.com/<you>/discord-username-sniper.git
cd discord-username-sniper
npm install
cp config.example.json config.json
```

Windows PowerShell equivalent for the copy:

```powershell
Copy-Item config.example.json config.json
```

## Configure

`config.json`:

```json
{
  "webhookUrl": "https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN",
  "token": "YOUR_ACCOUNT_TOKEN",
  "password": "YOUR_ACCOUNT_PASSWORD",
  "mode": "hammer",
  "namePatterns": ["4l", "4c", "3c"],
  "watchFile": "names.txt",
  "watchIntervalMs": 30000,
  "maxRounds": 0,
  "attemptDelayMs": 1100,
  "maxAttempts": 0,
  "stopOnSuccess": true,
  "menu": true
}
```

- `webhookUrl` — optional, notifications are skipped when absent.
- `token` — Discord account token. Sent as the `Authorization` header.
- `password` — account password. The username endpoint requires it.
- `mode` — `hammer` or `watch` when the menu is skipped.
- `namePatterns` — default pattern set for hammer mode.
- `watchFile` — path to the watch list.
- `watchIntervalMs` — pause between watch rounds, in milliseconds.
- `maxRounds` — `0` means watch forever.
- `attemptDelayMs` — pause between attempts, in milliseconds.
- `maxAttempts` — `0` means hammer until a hit or a stop.
- `stopOnSuccess` — exit after a successful change.
- `menu` — show the menus when run without arguments.

## Run

```bash
npm start                    # menus, pick mode and shape
node index.js hammer 3c      # random 3-char names, no menu
node index.js hammer 4l,4c,3c
node index.js watch          # watch names.txt
node index.js watch --dry    # show the parsed target list
node index.js --dry          # sample candidates / list targets
node index.js --no-menu      # use config.json settings only
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Username changed |
| 1 | Account lookup failed (bad token or network) |
| 2 | Attempt ceiling reached |
| 3 | Fatal stop: token, password, or verification challenge |

## Layout

```
index.js                 entry point, run loop
utils/nameGenerator.js   pattern parsing and candidate generation
utils/menu.js            interactive pattern menu
utils/apiService.js      Discord calls and webhook embeds
utils/errorHandling.js   error classification and rate-limit waits
utils/utils.js           config loading, logging, timing
```

## Notes

- The username endpoint answers `400` with `name unavailable` when a candidate is taken. That is a normal miss, not a failure.
- A `400` mentioning `captcha` means the server wants verification. The run stops clean instead of looping.
- Username changes are rate limited per account; long runs will hit `429` and wait.
- `config.json` is git-ignored. Never commit a token.

## License

MIT
