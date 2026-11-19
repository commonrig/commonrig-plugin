---
description: Upload a file to CommonRig through an upload link from the file tool, for when curl isn't there
argument-hint: <file> <upload link> [--keep]
allowed-tools: Bash
---
Ask CommonRig's `file` tool for a link first (action `upload`; `file_upload_url` on older servers), then run this with the file and that link, and report the output. A png or jpeg goes as webp when the machine has cwebp, magick or ffmpeg (about a third of the size), and the last line says so; `--keep` sends the original. It prints the file's id (`FIL-n`), which a report shows with `<img src="file:FIL-n" alt="...">`:

`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/helper/helper.mjs" put "$ARGUMENTS"`
