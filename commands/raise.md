---
description: Let programs on this machine raise bugs, findings and tasks in CommonRig, or raise one now
argument-hint: "connect [--no-browser] | --title <words> [--kind bug|finding|task] [--project <p>] [--body-file <f>] [--fingerprint <x>]"
allowed-tools: Bash
---
Run one of these and report its output. A non-zero exit is a refusal, and its last line says why.

When the arguments start with `connect`, sign this machine in for raising, once: it prints a short code and a page, which you show the person word for word. They type the code on any signed-in browser and tick what this machine gets. It waits for them, so give it a timeout of 600000. It is its own sign-in, apart from capture, holding `intake:write` and nothing else:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" raise connect "${user_config.workspace_url}" $ARGUMENTS`

Otherwise raise one item:

`node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" raise $ARGUMENTS`
