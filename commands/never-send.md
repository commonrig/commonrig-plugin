---
description: Words that never leave this machine. add, remove, mode drop or mask, or list
argument-hint: "add <word or \"a phrase\"...> | remove <word...> | mode drop|mask | list"
allowed-tools: Bash
---
Run this exactly, as one Bash call, and report its output in one line. Never repeat the listed words anywhere else, and never pass them to any other tool:

```
CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" never-send - <<'COMMONRIG_WORDS'
$ARGUMENTS
COMMONRIG_WORDS
```
