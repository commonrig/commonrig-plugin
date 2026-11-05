---
description: Run this machine as your CommonRig runner, for items and schedules delegated to it, or sign it in
argument-hint: "connect [--project <p>] [--flagged] [--harness claude|codex] [--no-browser] | --once [--execute claude|codex] | --loop [--execute claude|codex]"
allowed-tools: Bash
---
Run one of these and report its output. A non-zero exit is a refusal, and its last line says why.

When the arguments start with `connect`, sign this machine in as a runner, once, in the browser. It waits for the person, so give it a timeout of 300000. It is its own sign-in, apart from capture, holding `runner` and nothing else. The page asks where it works and what it may run:

`node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" runner $ARGUMENTS "${user_config.workspace_url}"`

Otherwise poll once and show what is ready, each with the command that runs it. Run nothing yourself: the person decides.

`node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" runner --once`
