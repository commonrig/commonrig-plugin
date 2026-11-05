---
description: Keep CommonRig's private names on this machine. A prompt that names one is never filed as a shared request
argument-hint: "[list | add <name> | remove <name>]"
allowed-tools: Bash
---
Run this as one Bash call and report its output in one line. Never repeat the names anywhere else, and never pass them to any other tool:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" names "$ARGUMENTS"`

The list never leaves this machine. The server only hears that a prompt matched a name, never which one.
