---
description: Sign this machine in to CommonRig with a short code: capture, and lanes, intake or a runner if you tick them
argument-hint: "[--lanes] [--intake] [--runner] [--all] [--decisions] [--no-browser]"
allowed-tools: Bash
---
Run this and show the person the code and the page it prints, word for word: they open the page on any device signed in to CommonRig (a phone is fine, and so is a machine other than this one, which is how it works over ssh), type the code, and tick what this machine gets. Nothing comes back to paste. It waits for them, up to ten minutes, so give it a timeout of 600000:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" connect "${user_config.workspace_url}" $ARGUMENTS`
