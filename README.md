# CommonRig plugin for Claude Code

Connects Claude Code to a CommonRig workspace and adds capture in one install. Optional: the workspace URL alone is all most clients need.

## Install

From the public marketplace: `/plugin marketplace add commonrig/commonrig-plugin` in Claude Code (or `claude plugin marketplace add commonrig/commonrig-plugin` in a terminal), then `claude plugin install commonrig@commonrig`. The public repo holds the newest signed release only, and a new release reaches it by itself.

From a checkout of this folder: `claude plugin marketplace add ./plugin`, then `claude plugin install commonrig@commonrig`. It asks for your workspace's MCP address, `https://<host>/w/<slug>/mcp` (such as `https://dev.commonrig.com/w/<slug>/mcp`), shown on Setup's Connect agents tab in the app. Node 20 or later is needed for capture.

## Update

Nothing updates by itself. A release is a new plugin version on a signed tag, `plugin-v<version>`: a marketplace added from `commonrig/commonrig-plugin` already holds the newest signed release (`/plugin marketplace update commonrig`), and a checkout is brought to that tag by hand, then `/plugin update commonrig` (and `/plugin update commonrig-guard` if you use the guard), and start a new session. The helper and guard run only a copy that matches its pinned digest and, once a release key is pinned, its signature.

## What it sends

Every prompt you type in a session where this plugin is on, and each final reply, masked on your machine first. Masked where recognised: nothing guarantees a secret is caught, so rotate any key you paste.

| Sent | Not sent |
| --- | --- |
| Prompt text, typed or pasted, and the final reply, each whole up to 32,000 characters | Any line of the session log: it is read on this machine for counts only |
| Only length and keyed hash for a block shaped like config, inside a long prompt too | File contents, tool output, full paths |
| Session id, prompt id, model, folder name, a hash of the git remote | Claude Code's sign-in tokens, which nothing here reads |
| Each session's tokens by model and working minutes, counted off its log at the end of each turn | |

Subagent reports, background task reports, messages from other sessions and scheduled prompts are dropped where they can be told apart, and only a count of them is kept. No field marks these, so this is best effort.

## Pause

`/commonrig:pause` holds capture on this machine, `/commonrig:pause --repo` for one repo, `/commonrig:resume` lifts it. While paused nothing is written or sent from this machine, only a count. An agent connected on its own still stores the first message of each session: pause under Connections to hold all your connections. `/commonrig:status` shows state and counts.

## Never send

`/commonrig:never-send add <word...>` keeps a list of words on this machine; quote a phrase to keep it whole: `add "project blue"`. A prompt or reply holding one stays here: it isn't spooled or sent, and the server gets a count of `never_send` and nothing else. `/commonrig:never-send mode mask` swaps each listed word for `[withheld]` instead of holding the whole message back. A folder named with a listed word goes as `[withheld]` either way. Rows spooled before a word went on are checked again when they're sent. The list is `never-send.json` in the plugin's data folder and is never sent to CommonRig (the command's words do pass through your agent's own session, as anything you type does); while the file can't be read, every prompt and reply is dropped, spooled ones too, and nothing dropped comes back once it's fixed. The command's own message and its reply are never sent, as they name the word. Whole words, any case. While this plugin's capture is signed in and live, the server keeps no copy of its own of what your agent passes to `start`; without capture signed in, the list can't cover what an agent sends.

## Private names

A request an agent files from your prompt is read by everyone in that project, while the prompt stays yours. So the server files none when your words also name another project in the workspace, or a project or workspace of yours elsewhere, and the agent asks you which part belongs here. For names the server can't know, such as a codename or a client, keep a list on this machine: `/commonrig:names add <name>`, `/commonrig:names remove <name>`, `/commonrig:names` to see it. It lives in `private-names.txt` in the plugin's data folder, one name a line, and you can edit it by hand. It never leaves the machine: a prompt that names one is sent with a flag saying so, never which name, and while the list holds a name, the helper says only that there is one, so words an agent passes on by itself are held too. Your prompt itself is still captured, as yours alone. A list file that can't be read counts as a match.

## Sign in

The tools sign in through Claude Code's own MCP sign-in. After the install, CommonRig shows as needing authentication: in a terminal run `claude`, type `/mcp`, pick `plugin:commonrig:commonrig` and choose Authenticate. Your browser opens, you approve, and the tools appear (start a new session if they don't). Every MCP call needs a token, so a client that isn't signed in is asked to sign in rather than shown connected with no tools.

The Claude desktop app can't sign this one in from its own Authenticate button yet: it refuses with 'connector points at a different server URL', as the plugin's address is your own workspace's, filled in at install. Sign in from the terminal as above instead.

Capture has a sign-in of its own, so it stays separate from your agent's: run `/commonrig:connect` once. It prints a short code and the device page's address: type the code on any browser where you are signed in (over SSH too, nothing comes back to paste), tick what this machine gets, and allow it. Capture shows under Connections as a device with one-click revoke. It holds the `capture` scope and nothing else: it can send, it can't read your work. The same page offers lanes, programs raising work and a runner, each its own connection, ticked with `--lanes`, `--intake`, `--runner` or `--all`. `--loopback` is the older browser sign-in. The sign-in sits in a file only you can read in the plugin's data folder, and no token is ever shown.

Until you sign in, masked rows wait in a local spool (5 MB, then counted and dropped) and nothing leaves the machine. On Windows the sign-in file takes its folder's permissions: you, SYSTEM and administrators. `/commonrig:disconnect` signs out here.

## Programs raise work

A test run, a monitor or any script on this machine can raise a bug, a finding or a task. Sign the machine in for it once: `/commonrig:raise connect` (or `node <plugin folder>/helper/helper.mjs raise connect <workspace mcp url>`: a short code to type on any signed-in browser, over SSH too). It is a sign-in of its own, apart from capture, kept in `~/.commonrig-intake` (or `COMMONRIG_INTAKE_DIR`), holding `intake:write` and nothing else: it raises, and reads nothing. It shows under Agents > Connections as a program intake, revoked in one click.

Then a program runs `node <plugin folder>/helper/helper.mjs raise --title "nightly build failed" --kind bug --project web --source nightly --body-file build.log --fingerprint build-web`. Each lands not planned, with no project waiting unfiled for a person (where only an owner sees unfiled work, a project is needed). The same `--fingerprint` from the same machine inside 24 hours adds a count and a 'seen again' note to the open item instead of a new one. At most 60 an hour a device. The last 20,000 bytes of a body file go, masked here and again on the server. A refusal exits 1 with its reason.

## A runner on this machine

A runner works the items and schedules a person delegates to their runners, on their machine, for them. Sign the machine in once: `/commonrig:runner connect` (or `node <plugin folder>/helper/helper.mjs runner connect <workspace mcp url>`: a short code to type on any signed-in browser, over SSH too). The page asks where it works (the whole workspace, one project, or only records that name this runner) and which harness it may run in execute mode (none, Claude Code or Codex). It is a sign-in of its own, kept in `~/.commonrig-runner` (or `COMMONRIG_RUNNER_DIR`), holding `runner` and nothing else: it reads only what is delegated to it. It shows under Agents > Connections with its last poll and what it holds, revoked in one click.

`helper.mjs runner --once` polls once: each ready record is printed with a brief file and the command that runs it, and at a terminal it asks for your go. `helper.mjs runner --loop --execute claude` polls every 2 minutes and runs `claude -p` on each record set to execute, the brief on stdin; anything set to prompt is printed for you instead. A record runs only where this machine passed `--execute` and the runner declared that harness at sign-in. First claim wins among your runners. A run says started, then done or failed with the tail of its output, masked here and again on the server; a schedule is pinged too. The harness's own agent takes the claim over with `item_claim` `take`.

A run that needs a key (a provider key, a deploy token) gets it by link, never from CommonRig: on the project's Settings, Integration keys, 'link a runner key' names the variable, your password manager and where the key lives in it. Just before an execute run this machine reads each one with that manager's own command, `op read`, `bws secret get` (its value only) or `vault kv get -field`, run as arguments with no shell, into that run's environment and nowhere else: no file, no command line, never sent back. Sign the manager in on this machine first (`OP_SERVICE_ACCOUNT_TOKEN`, `BWS_ACCESS_TOKEN`, `VAULT_TOKEN`). Only links you set reach your runners. A name ends in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD` and is never one that steers the run (a path, proxy, address or a tool's own setting). A key it can't read stops the run before it starts and the run reports which variable; a run that held a linked key reports done or failed with no output.

Once you switch it on for this runner under Setup, Your data, each poll also checks whether a daily copy of your records is due, and if so writes it into `export` in the runner's folder (or `COMMONRIG_EXPORT_DIR`): the same markdown and JSON files the download makes, your own prompts and everything you can see. The new copy replaces the last only once it is whole. It uses the runner's own sign-in, so nothing on the server keeps a password or key for it.

## Your quota

Opt in on your quota page (`#/quota`, 'Show my quota'; the weekly burn hint is a second switch). Nothing reaches an agent: the numbers go from this machine to your page and back to you alone. Add the status line command to Claude Code (`statusLine` in `~/.claude/settings.json`, command `node <plugin folder>/helper/helper.mjs statusline`): it keeps Claude's latest 5-hour and 7-day used percent and reset times in `quota-claude.json` beside the sign-in, shows `5h 42% · 7d 18%` in the bar, and posts them behind it at most every 5 minutes. Set `COMMONRIG_QUOTA_ACCOUNT` to label the account (default `main`). With `OPENROUTER_API_KEY` (or `COMMONRIG_OPENROUTER_KEY`) in the environment, the credit left from OpenRouter's key-info call goes too; the key is used here and never sent. Codex is not read: its quota is behind an app-server a hook may not start, so the page says so. While the page is off the server drops what arrives and the helper asks again in an hour. `helper.mjs quota [--now]` posts once by hand. The runner does not report quota yet: its sign-in holds `runner` and nothing else.

## Putting up a file

An agent puts a screenshot up without its bytes passing through the chat: CommonRig's `file_upload_url` tool gives a link for one file, good once for 10 minutes, and `curl -T shot.png '<link>'` sends it. Where curl isn't there, `/commonrig:put <file> <link>` does the same through this plugin. It sends the file and nothing else, no sign-in, and only to the server this machine signed in to. A report then shows it with `<img src="file:FIL-n">`.

## Codex

The tools: Codex connects to the CommonRig MCP server with its own sign-in. `codex mcp add commonrig --url <workspace>/mcp` writes these two lines to `~/.codex/config.toml` and opens the browser to approve; `codex mcp login commonrig` signs in again:

```toml
[mcp_servers.commonrig]
url = "https://<host>/w/<slug>/mcp"
```

Codex asks before each CommonRig call. `default_tools_approval_mode = "approve"` under that table lets it call without asking; `codex exec` with `approval_policy = "never"` needs it, or every call fails as needing approval. Run against dev with `py -3.14 scripts/live-test.py scripts/codex-run.mjs`: Codex's own OAuth sign-in, then `start`, `prompt_list` and `item_update` from `codex exec`, read back on a connection of its own.

Capture: Codex has no plugin of this kind, only one hooks file for every folder, so the helper has a Codex mode: `node helper/helper.mjs hook --codex --only <repo folder> --data <data folder>` on SessionStart, UserPromptSubmit and Stop in `~/.codex/hooks.json`. It does nothing outside the `--only` repos. Point `--data` at this plugin's data folder in Claude Code and the one sign-in, never-send list, private names and pause cover both; the same masking runs. SessionStart gives the agent its session id for `start`, as with Claude. A turn's id pairs a prompt with its reply. It spools in line and sends from a process of its own, so a turn never waits on the network. On Stop the token counts are read off the Codex rollout on the machine (`readCodexUsage`: counts and minutes, never a line of it), fresh input apart from cached as Claude's are. `codex exec` sessions are marked as an agent's. Codex asks you to trust its hooks again after the file changes. The hook shapes are unit-tested; the usage reader was checked against real rollouts, but the capture hooks themselves haven't had a real Codex run.

The guard is a separate, opt-in plugin in this folder: `commonrig-guard`. See `guard/README.md`.

`helper/helper.mjs`, `helper/helper.bundle.mjs` and `helper/release.json` are built from `packages/helper` with `npm run bundle -w @commonrig/helper`. Never edit them by hand. `helper.mjs` is a small launcher: it runs the bundle only when it matches the digest pinned in `release.json`, and once a release key is pinned, only with a good `release.sig` beside it. A copy that fails sends nothing and says why. Releases, keys and checking a copy by hand: `docs/helper-release.md`.

## Asking the decisions endpoint from a script or hook

Once the workspace's owner and you have turned the decisions endpoint on (Setup > Workspace, Setup > Your data), a script or hook on this machine can ask it a question. Sign in with the decisions box ticked: `node <plugin folder>/helper/helper.mjs connect <workspace mcp url> --decisions` (a runner ticks the same box on its own page). Then `helper.mjs decide --preset failure_triage --state-file input.json` prints the answer as JSON, or `{"ok":false}` when it can't answer inside a second: a hook carries on without it. Presets are `reads_like`, `pick_best_hit`, `covers_topic`, `lane_state`, `failure_triage` and `skill_suggest`; a raw question takes `--state-file` and `--questions-file`. `--runner` asks through the runner's sign-in instead.
