# capcut-mcp

An MCP server that assembles **CapCut International** projects and generates the assets
CapCut cannot make itself, so an editor opens a timeline that is mostly done instead of
an empty one.

> **Independent and unofficial. Not affiliated with ByteDance or CapCut.**
> It works by reading and writing CapCut's local project files, a private and
> undocumented format. Use on projects you can afford to have backed up.

**Status: early.** Verified by hand on CapCut 9.1.0 (Windows). Every write tool is
gated behind `check_compatibility`, and `restyle_captions` has a `dryRun` mode.

---

## What it is, and what it is not

**Is:** a draft compiler. Cuts, captions, music, titles and code-driven overlays
assembled into a real CapCut project.

**Is not:** a renderer, and not a replacement for the editor. CapCut's AI features —
auto-captions, auto-reframe, cloud effects — run on ByteDance servers. A project file
can only *reference* resources that already exist in their catalogue. This tool cannot
invoke them, and will not pretend otherwise.

The split it is built around: **the machine does assembly, the human does taste.**
Uniform caption styling across a whole video is assembly. Masking, keyframe easing and
colour grading are taste.

---

## Requirements

- Node.js ≥ 20
- CapCut International (`app_source: "cc"`). **JianYing is not supported** — from 6.0 it
  encrypts the project on every save, which makes round-trip editing impossible.
- `ffmpeg` / `ffprobe` — optional for reading, required for overlay rendering
- **CapCut must be closed** when writing. The editor holds the project in memory and
  overwrites the file on close.

---

## Setup

### 1. Install and build

```bash
git clone https://github.com/yabdulaziz2009-dev/capcut-mcp.git
cd capcut-mcp
npm install
npm run build          # compiles src/ -> dist/
```

Optional, and only if you want `render_overlay` / `compose_overlay` — it pulls a
headless browser (~hundreds of MB):

```bash
npm install --prefix remotion
```

### 2. Register the server with your MCP client

The server speaks stdio and takes no arguments beyond its own path. Use the **absolute**
path to `dist/index.js`.

**Claude Code** — one command:

```bash
claude mcp add capcut -- node /absolute/path/to/capcut-mcp/dist/index.js
```

**Claude Desktop** — `claude_desktop_config.json`
(`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "capcut": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/absolute/path/to/capcut-mcp/dist/index.js"]
    }
  }
}
```

> On Windows use forward slashes in the JSON, or escape the backslashes (`C:\\Users\\…`).

Restart the client, then ask it to list your CapCut projects. If `list_projects` returns
your drafts, the server is wired up.

### 3. Where projects are read from

The local draft store is found automatically:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft` |
| macOS | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft` |

Every tool also accepts an explicit `project` path — either the project folder or its
`draft_content.json`.

### Verify

```bash
npm test           # 32 unit tests, no CapCut install needed
npm run typecheck
```

### Troubleshooting

| Symptom | Cause |
|---|---|
| Tools missing after restart | Path in the config is relative, or `npm run build` was never run |
| `refuse: editor is running` | CapCut is open — close it, it rewrites the draft on exit |
| `refuse: JianYing draft` | Encrypted format, not supported (see above) |
| `render_overlay` fails | `ffmpeg` not on `PATH`, or `npm install --prefix remotion` was skipped |
| Changes vanish | The project was open in CapCut during the write |

---

## Tools

| Tool | What it does | Writes? |
|---|---|---|
| `list_projects` | CapCut projects in the local draft store | no |
| `inspect_project` | Duration, tracks, subtitles as readable text, populated material buckets | no |
| `check_compatibility` | `ok` / `warn` / `refuse` verdict before any write | no |
| `restyle_captions` | One style across every caption at once, plus an entrance animation | yes |
| `import_subtitles` | An SRT file (or raw SRT text) as a styled caption track, with keyword highlighting | yes |
| `render_overlay` | Animated motion graphics with a real alpha channel (ProRes 4444) | no |
| `add_overlay` | Place a rendered clip on its own track | yes |
| `compose_overlay` | Render and place in one call | yes |

### `restyle_captions`

The most repetitive job in short-form editing: the same outline, shadow and plate on
every caption, set by hand one segment at a time.

Presets: `bold-outline` (white on heavy black stroke — the shorts default), `boxed`
(rounded dark plate), `accent` (brand colour with dark outline). A preset can be nudged
field by field rather than replaced.

Supported: size, colour, weight, opacity, outline, shadow (colour, angle, distance,
blur), background plate, entrance/exit animation from 76 upstream slugs.

**Not supported — and it says so instead of pretending:** font family and on-screen
position. Neither is reachable through `capcut-cli`; see `GATE0-FINDINGS.md` §6.

Re-running is safe: captions that already carry an animation keep it and are reported,
because upstream can add an animation but not replace one.

### `render_overlay` — the differentiator

CapCut cannot author code-driven motion graphics; editors leave for Remotion and come
back with a transparent clip. This closes that loop.

Kinds: `lower-third` (name bar), `title-card` (centred statement), `callout` (pill
badge). Text, colours, size, duration and exit timing are parameters — no code is
generated per overlay.

Output is **ProRes 4444, `yuva444p10le`** — verified to carry a genuine alpha channel
(93–96% of pixels fully transparent on the shipped kinds), not a black background.

**Confirmed end-to-end on CapCut 9.1 / Windows:** the rendered overlay was placed on its
own track and the footage showed through its transparent areas in the editor.

```
npm install --prefix remotion     # one-time, pulls a browser (~hundreds of MB)
```

Requires `ffmpeg`. A 2.5-second 1080×1920 overlay renders in ~17 s.

> The Remotion project lives in `remotion/` as a **sibling package**, not a dependency
> of the server, so installing `capcut-mcp` does not drag a browser along for the tools
> that never need one.

Always run `check_compatibility` first. It refuses on JianYing drafts, a running editor,
an upstream write-guard block, or pre-existing integrity errors — and warns about
untested CapCut versions, diverged storage mirrors and missing binaries.

## Version support

Verified by hand on **CapCut 9.1.0 (Windows)**: an externally written text segment
survived being opened in the editor. Details and the defects found along the way are in
[`GATE0-FINDINGS.md`](./GATE0-FINDINGS.md).

CapCut 9.x has **no upstream test fixture**, so `check_compatibility` reports it as
untested even though it works here. That is deliberate: the format is private and can
change without warning, and an honest warning beats a silent corruption.

## Credit

Draft reading and writing is done by [`capcut-cli`](https://github.com/renezander030/capcut-cli)
(MIT), which handles the transactional multi-file write CapCut 9.x needs — the modern
layout keeps a `template-2.tmp` mirror beside `draft_content.json`, and both must stay
in sync. This project adds the MCP layer, workflow-level composites, and the Remotion
overlay bridge.

## Licence

MIT.
