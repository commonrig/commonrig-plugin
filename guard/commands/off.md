---
description: Stop checking on this machine, at once
allowed-tools: Bash
---
Only when the person asked. Run this and report the output.

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_OPTION_WORKSPACE_URL="${user_config.workspace_url}" node "${CLAUDE_PLUGIN_ROOT}/guard.mjs" off`
