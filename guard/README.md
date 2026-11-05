# CommonRig guard for Claude Code

Opt-in, and separate from the capture plugin. It checks your workspace's own rules before a command or an edit runs on this machine. CommonRig runs nothing: your harness runs this hook, on your machine, because you installed it.

## Install

From a checkout: `claude plugin marketplace add ./plugin`, then `claude plugin install commonrig-guard@commonrig`. Then `/commonrig-guard:connect`: a browser page asks you to allow it, and it shows under Agents > Connections as a device with one-click revoke. It has a sign-in of its own, the `rules` scope and nothing else. It can't read your work. To update, see 'Update' in the plugin's own README: `/plugin update commonrig-guard` once the marketplace checkout is on the new signed tag.

## What it does

- It keeps a saved copy of the rules in the plugin's data folder and refreshes it behind the scenes, at most every 5 minutes. Neither a command nor a session start waits on the network.
- It reads rules with a local check: `local_command`, `local_commit`, `local_path`, and two slips that take no words: `local_pkill_self` (a `pkill -f` whose pattern matches the shell running it, so the call kills itself, `ssh` and `bash -c` payloads too) and `local_piped_push` (a `git push` later in the same command than a test, build or lint piped into a filter, `npm test | tail; git push`, as a red check still pushes; `gh`, `docker ps` or `npm ls` at a pipe's head is no check). Accepted by an owner, workspace-wide. A rule for one project stays out: a machine has no project.
- A guard older than 0.1.1 can't read the two slips: it lets every call go and logs `failed`. If the rule is strict and on, it refuses every guarded call instead, edits included, until the plugin is updated. Update the plugin before turning a slip rule on.
- A rule in log mode writes down what it would have done and stops nothing. Every new rule starts there.
- A rule that is on refuses, or at 'ask first' puts the call to you through Claude Code's own prompt. It can never say allow.

## What it sends

Rule number, version, tool name, a fixed outcome, and the rule's own word. Never a command, a path, a prompt or a file. Paused under Connections, the server keeps none of it and the rules still apply here.

## When something breaks

| Event | What happens |
| --- | --- |
| Server down, or signed out | The saved copy stands, for as long as it takes |
| No saved copy yet | Nothing is checked, and the session is told |
| A rule's check can't be read | The call goes, and it's logged. A rule marked strict refuses instead |
| Saved copy goes bad while a rule is strict | Refuses, and says how to turn it off. The guard's own commands always get through |
| The hook itself crashes or times out | Claude Code runs the call |

## What it isn't

It reads command text. `git` inside a script, an alias or a file a script writes gets past it. It stops slips, not an agent set on hiding. `/commonrig-guard:off` stops it here at once, for you or for an agent you've let run it. It covers Bash, PowerShell, Write, Edit, MultiEdit and NotebookEdit.

Claude Code is the only harness it has been run with. A Codex mode exists, `node guard.mjs hook --codex --only <repo folder> --data <data folder>` on PreToolUse `^(Bash|apply_patch)$` in `~/.codex/hooks.json`: it reads Codex's Bash, as a string or an argv, and each file a patch touches, on the same saved copy. It only watches until `--enforce` is added, and as Codex can't ask a person mid-call, an ask first rule refuses there and says who decides. It has unit tests but no real Codex run yet, so nothing is promised for it, nor for OpenCode, Pi or Cursor.

`guard.mjs`, `guard.bundle.mjs` and `release.json` are built from `packages/helper` with `npm run bundle -w @commonrig/helper`. Never edit them by hand. `guard.mjs` runs `guard.bundle.mjs` only when it matches the digest in `release.json`, and once a release key is pinned, only with a good `release.sig`: see `docs/helper-release.md`. A copy that fails keeps your off switch working, refuses while a strict rule is saved here, and otherwise lets the call go and says why.
