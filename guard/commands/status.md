---
description: Show the guard here: signed in, counts, age of the saved copy
allowed-tools: Bash
---
Run this and report the output. It holds counts only.

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_OPTION_WORKSPACE_URL="${user_config.workspace_url}" node "${CLAUDE_PLUGIN_ROOT}/guard.mjs" status`
