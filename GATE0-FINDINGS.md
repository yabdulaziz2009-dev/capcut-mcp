# Gate 0 — CapCut 9.1 findings

Verified on a real machine, 2026-08-04. CapCut **9.1.0.3879**, Windows 11,
`capcut-cli` 0.16.0 (npm; git is already at 0.16.1).

The question Gate 0 had to answer: **does an edit written from outside survive being
opened in CapCut 9.1?** Upstream marks 9.x `expected-compatible, unverified`, and its
8.7 note warns that newer builds may ignore `draft_content.json` or reject
tool-written drafts.

---

## Result: editing existing projects — WORKS ✅

A Cyrillic text segment was written into a copy of a real 4-minute project, the copy
was opened in CapCut 9.1, and **the text was there and the project played normally**
(confirmed visually by the owner).

Supporting evidence from before the open:

```
canonical            : template-2.tmp        ← not draft_content.json
modern_storage       : true
diverged             : false
draft_content.json   : tracks=3 segments=3  hash=dfdd311f183e2db6
template-2.tmp       : tracks=3 segments=3  hash=dfdd311f183e2db6
lint                 : 0 errors, 0 warnings
write_guard          : ok
```

**CapCut 9.1 does keep a `template-2.tmp` mirror**, and `capcut-cli` writes both files
in one transaction — identical timeline hashes. A hand-rolled implementation writing
only `draft_content.json` would have lost the edit silently. This alone justifies
depending on the upstream library.

### Version markers

| | 7.8.0 project | 9.1.0 project |
|---|---|---|
| `schema_int` | 360000 | **360000** (same) |
| `new_version` | 153.0.0 | 179.0.0 |
| `mask_field` | none | none |
| support status | untested | untested, `write_guard: ok` |

### UTF-16 text ranges — correct

`add-text` with `"Привет из capcut-mcp"`:
20 characters → 40 UTF-16LE bytes → style `range: [0, 40]`. Exact match.
Cyrillic is handled correctly by upstream; this is not a gap to build a product on.

---

## Result: creating projects from scratch — DOES NOT WORK ❌

`capcut init` + `capcut register` produce structures CapCut 9.1 does not accept.
Three concrete defects, all reproducible:

### 1. Real CapCut projects carry TWO different ids — `register` collapses them

```
0804 (real):  draft_content.json  id       = 0FD72F62-0D06-44e0-BB50-F0015A95A7E0
              draft_meta_info     draft_id = 33367F41-0043-45b5-81E2-98868DE57F81

0731 (real):  draft_content.json  id       = F8BF215D-50CC-499f-B250-224EF7F781C1
              draft_meta_info     draft_id = 92871F3E-3915-4df5-976F-9A42792D24B5
```

The timeline id and the catalogue id are **independent by design**. `capcut register`
reports the meta as having "stale fields (draft_id …)" and rewrites `draft_id` from
`draft_content.json`, producing `draft_id == content.id` — a state real CapCut never
creates.

### 2. Path separator convention differs

Real CapCut writes forward slashes in `draft_fold_path`:
`.../CapCut/User Data/Projects/com.lveditor.draft/0804`
CLI-written entries use backslashes:
`...\Projects\com.lveditor.draft\0804-mcptest`

### 3. `draft_json_file` should be null

Real projects: `draft_json_file: None`. CLI-created: populated with a path, and on
`init` it points at `draft_info.json` even though `draft_content.json` exists beside it.

### 4. `init` leaves `id` empty and `duration` at 0

A project from `capcut init` has `id: ""` in `draft_content.json`. After `add-text` it
has 1 track / 1 segment but **`duration` stays 0** — the segment exists, the timeline is
formally empty, so nothing plays.

### 5. `init` defaults to the wrong directory

Without `--drafts` it creates the project under `%USERPROFILE%\Movies\CapCut\...`,
not where real projects live (`%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft`),
and registers it in a fresh `root_meta_info.json` there — invisible to the app.

---

## Consequences for capcut-mcp

1. **v1 targets existing projects.** Read, edit, extend — proven to work.
2. **`create_project` must clone**, not `init`: copy a real project, then mint **both**
   ids independently and preserve CapCut's conventions (forward slashes,
   `draft_json_file: null`).
3. **Recompute `duration` after every mutation** — the validation step already planned
   is not theoretical.
4. **Do not use `capcut register` as-is** on copies. Write the catalogue entry ourselves,
   or fix upstream.

---

## Further defects found while building `restyle_captions`

### 6. `text-style` lists flags it silently ignores

`capcut text-style --help` advertises `--font-size`, `--color`, `--align`, `--x`, `--y`.
Passing **only** those returns `{"error":"No styling flags provided."}` — they are not
recognised as styling flags at all. Honoured: `--alpha`, `--border-*`, `--bg-*`,
`--shadow-*`.

Consequence: colour and size must go through `text-ranges` instead; **on-screen
position and alignment cannot be set at all** by either command.

### 7. `text-anim` is not idempotent and cannot replace

Applying an intro animation to a segment that already has one fails with
`{"error":"segment already has a in text animation"}`. There is no `--replace`. Running
a styling pass twice therefore aborts partway and leaves the project half-styled unless
the caller catches this specific error — which `restyleCaptions` now does.

### 8. Empty font catalogue

`capcut enums --fonts` returns 0 entries, and no command exposes a typeface option, so
font family cannot be changed programmatically. `--text-intros` by contrast returns 76
usable slugs.

---

---

### 11. `font_path` is an absolute, version-pinned path — projects are not portable

Raised in review by a second pair of eyes, then verified:

```
font_path = C:/Users/<user>/AppData/Local/CapCut/Apps/9.1.0.3879/Resources/Font/SystemFont/en.ttf
```

The path embeds **both the username and the application version**. It breaks when the
project moves to another machine *and* when CapCut simply updates — `Apps/9.1.0.3879`
stops existing.

Worse: `font_name`, `font_id` and `font_title` on the material are all empty, so the
font cannot be resolved by name — only by that path. Cyrillic captions point at `en.ttf`.

**Not yet known:** whether CapCut repairs the path on open. Our project opened and
rendered correctly on the machine that wrote it, so it tolerates its own path; cross-
machine portability is untested.

**Cannot be fixed from here anyway:** `text-style` exposes no typeface option and
`enums --fonts` returns an empty catalogue (§8). Validation could warn, not repair.

---

## Environment traps (ours, not upstream's)

### 9. `spawnSync npx.cmd` fails with EINVAL on Windows

Node ≥20.12 refuses to spawn `.cmd`/`.bat` without a shell (CVE-2024-27980), so calling
`npx remotion render` from the server dies with `EINVAL` and **no stdout or stderr** —
it looks like a silent render failure.

`shell: true` is not the fix here: the render passes JSON props containing Cyrillic and
quotes, which a shell would mangle. The bridge invokes
`node <project>/node_modules/@remotion/cli/remotion-cli.js` directly instead.

### 10. `--log=error` hides the reason a render failed

Combined with #9 this produced `Remotion render failed: no output`. Keep Remotion's
default logging so a failure carries its cause.

---

## Worth upstreaming

Findings 1–5 are concrete, reproducible bugs with a real 9.1 fixture available via
`capcut fixture --out`. Reporting them is cheap and buys goodwill with the project we
depend on.

---

## Test artefacts to clean up

- `…\com.lveditor.draft\mcp-gate0-test` — scratch project from `init`
- `…\com.lveditor.draft\0804-mcptest` — copy of the owner's `0804`
- entries for both in `root_meta_info.json`

The owner's own `0731` and `0804` were never modified.
