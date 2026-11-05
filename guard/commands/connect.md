---
description: Sign this machine in to fetch its rules
allowed-tools: Bash
---
Run this and show the person the code and the page it prints, word for word: they type the code on any device signed in to CommonRig, over ssh too, and nothing comes back to paste. It waits for them, so give it a timeout of 600000.

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_OPTION_WORKSPACE_URL="${user_config.workspace_url}" node "${CLAUDE_PLUGIN_ROOT}/guard.mjs" connect $ARGUMENTS`
