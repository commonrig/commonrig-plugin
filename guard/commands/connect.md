---
description: Sign this machine in to fetch its rules
allowed-tools: Bash
---
Run this. It prints a link: show it to the person so they can sign in and allow it. Add --no-browser over SSH, and pass on the address they paste back.

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_OPTION_WORKSPACE_URL="${user_config.workspace_url}" node "${CLAUDE_PLUGIN_ROOT}/guard.mjs" connect $ARGUMENTS`
