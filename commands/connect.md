---
description: Sign this machine in for CommonRig capture, once, in your browser
argument-hint: "[--no-browser]"
allowed-tools: Bash
---
Run this and report its output. Sign-in waits for the browser, up to five minutes, so give it a timeout of 300000:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" connect "${user_config.workspace_url}" $ARGUMENTS`
