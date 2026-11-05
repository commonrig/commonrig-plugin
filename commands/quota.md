---
description: Send this machine's quota numbers to your CommonRig quota page now, or print the status line snippet that keeps them fresh
argument-hint: "[--now]"
allowed-tools: Bash
---
Run this and report the output. It posts numbers only (used percent, reset time, credit left), and the server drops them unless the person switched on 'Show my quota' on their quota page. Never a key, token or prompt:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" quota $ARGUMENTS`

To keep the numbers fresh, the person adds the status line command to their Claude Code settings (`statusLine` in `~/.claude/settings.json`). It writes Claude's latest 5-hour and 7-day numbers to a local file and posts them at most every 5 minutes:

`{ "statusLine": { "type": "command", "command": "node \"<plugin folder>/helper/helper.mjs\" statusline" } }`
