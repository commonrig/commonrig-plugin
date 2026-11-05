---
description: Run this machine as your CommonRig runner, for items and schedules delegated to it, or sign it in
argument-hint: "connect [--project <p>] [--flagged] [--harness claude|codex] [--no-browser] | --once [--execute claude|codex] | --loop [--execute claude|codex]"
allowed-tools: Bash
---
Run one of these and report its output. A non-zero exit is a refusal, and its last line says why.

When the arguments start with `connect`, sign this machine in as a runner, once: it prints a short code and a page, which you show the person word for word. They type the code on any signed-in browser and tick what this machine gets. It waits for them, so give it a timeout of 600000. It is its own sign-in, apart from capture, holding `runner` and nothing else. The page asks where it works and what it may run:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" runner $ARGUMENTS "${user_config.workspace_url}"`

Otherwise poll once and show what is ready, each with the command that runs it. Run nothing yourself: the person decides.

`node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" runner --once`
