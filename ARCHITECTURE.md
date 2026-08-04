# Architecture

> Superseded the pre-research draft of this file on 2026-08-04. Two findings reshaped
> it: the draft I/O core already exists upstream, and the real gap is not "control
> CapCut" but "make what CapCut cannot".

## The shape

```
                    ┌──────────────────────────────┐
                    │   capcut-mcp  (MCP server)   │
                    │  workflow-level tools, not   │
                    │  a 1:1 mirror of 78 commands │
                    └──────────────┬───────────────┘
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
   │  capcut-cli      │  │  Remotion bridge │  │  asset gen       │
   │  (library dep)   │  │  (ours)          │  │  LUT .cube, SRT  │
   │  draft I/O,      │  │  overlay render  │  │                  │
   │  safety, lint    │  │  w/ alpha        │  │                  │
   └──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Layers

| Directory | Responsibility |
|---|---|
| `src/capcut/` | The **only** place that talks to `capcut-cli`. Thin by design: when upstream changes, the blast radius is one directory. `adapter.ts` shells out per command; `textStyle.ts` is the bulk path (see below). |
| `src/workflows/` | Composite operations expressed as an editor would describe them. |
| `src/mcp/` → `src/index.ts` | Tool definitions, schemas, error mapping. |
| `src/remotion/` | Overlay bridge — renders alpha-channel video from a spec, driving the sibling `remotion/` package. |
| `src/assets/` | LUT (`.cube`) writer, SRT builder. *(not yet built)* |
| `remotion/` | Sibling package holding the overlay compositions. Not a dependency of the server — it pulls a browser, and only one tool needs it. |

**Layering rule:** we never parse or serialise `draft_content.json` ourselves. Every
read and write goes through `capcut-cli`.

### The one narrowing of that rule: bulk styling

Driving `capcut text-style` / `text-ranges` once per caption measured **1.96 s per
caption** — 55 s for 28 captions, while a real short carries 100–200. Every call spawns
a process, rewrites both storage mirrors and appends a history snapshot; one pass left
40 snapshots and 3 MB behind.

`src/capcut/textStyle.ts` therefore loads the draft with `loadDraft`, mutates text
materials **in memory**, and commits once with `saveDraft`:

```
per-caption CLI calls :  54.9 s for 28 captions  (1960 ms each, 40 snapshots)
single in-memory pass :   2.0 s for 28 captions  (72 ms each,  1 snapshot)
                          → 27× faster
```

The rule is narrowed, not broken: we still do not parse or serialise the file. Upstream
supplies the typed graph and performs the write, so the version guard, editor check,
backup, atomic temp→fsync→rename and `template-2.tmp` mirror sync all still apply. What
we take on is knowledge of text-material field names — stable across the 7.8 and 9.1
drafts observed, and `lint` verifies the result after every write.

Deep imports (`capcut-cli/dist/decorators.js`) are blocked by the package's `exports`,
so reusing upstream's `setTextRanges` is not an option.

Anything beyond text materials still goes through the CLI, one call at a time.

## Why depend on capcut-cli

It is MIT, has zero runtime dependencies, 78 commands, and implements the whole safety
model: version guard, editor-running check, backups, atomic temp→fsync→rename writes,
**transactional multi-file writes with rollback**, and a stale-on-disk conflict guard.

That multi-file write is not a nicety. CapCut 9.x keeps a `template-2.tmp` mirror
beside `draft_content.json`, and the editor reads the mirror. An implementation writing
only `draft_content.json` loses the edit silently — see `GATE0-FINDINGS.md`.

The dependency is pinned exactly. The licence permits a fork if upstream stalls.

## Safety

`check_compatibility` runs before any write and is the gate, not a suggestion:

- **refuse** — JianYing draft, upstream write guard blocked, editor running, or the
  project already has integrity errors
- **warn** — untested CapCut version, diverged storage mirrors, lint warnings, missing
  `ffmpeg`/`ffprobe`
- **ok** — writable, storage consistent

Refusals name what was found. Never "try anyway".

## Known constraints, discovered by testing

1. **Editing existing projects works** on CapCut 9.1 — verified end-to-end.
2. **Creating projects from scratch does not.** `capcut init` + `register` produce
   structures the app does not accept: real projects carry two independent ids
   (timeline id ≠ catalogue `draft_id`), use forward slashes in paths, and leave
   `draft_json_file` null. So `create_project` must **clone** a real project and mint
   both ids, not synthesise a draft.
3. **`duration` must be recomputed after every mutation.** A project can hold segments
   while reporting zero length; CapCut then opens it with nothing to play.
4. Cloud AI features are unreachable by design — files can only reference catalogue
   resources that already exist.

## Scope

**Built:** `list_projects`, `inspect_project`, `check_compatibility`,
`restyle_captions`, `render_overlay`, `add_overlay`, `compose_overlay`.

**Next:** `import_subtitles` (SRT → styled track), asset generation (LUT `.cube`),
and an integration test against a committed fixture project.

**Not in v1:** GUI automation, JianYing, mobile, final video export, cloud AI,
transcript cutting (CapCut ships it natively).
