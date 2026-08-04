import { runCommand, type CommandName } from "capcut-cli";

/**
 * The only place that talks to `capcut-cli`.
 *
 * Everything above this file works with plain data. When upstream changes its API —
 * and it will, the draft format is private and moving — the blast radius is this
 * directory instead of every workflow.
 */

export class CapCutError extends Error {
  constructor(
    message: string,
    readonly detail?: { command: string; stderr?: string; status?: number | null },
  ) {
    super(message);
    this.name = "CapCutError";
  }
}

type RunOptions = {
  project?: string;
  args?: Array<string | number | boolean>;
  /** Piped to the command's stdin — lets `import-srt -` take generated SRT with no temp file. */
  input?: string;
  /** Commands that legitimately exit non-zero (lint returns 2 on findings). */
  allowExitCodes?: number[];
};

/**
 * Runs one capcut-cli command and returns its parsed JSON.
 *
 * capcut-cli prints a JSON object on stdout for every command, so the JSON is the
 * contract — never scrape the human-readable lines.
 */
export function run<T>(command: CommandName, options: RunOptions = {}): T {
  const result = runCommand<T>({
    command,
    project: options.project,
    args: options.args,
    input: options.input,
  });

  const tolerated = options.allowExitCodes ?? [];
  if (!result.ok && !tolerated.includes(result.status ?? -1)) {
    // capcut-cli reports failures as {"error": "..."} on stdout; prefer that over
    // stderr, which carries warnings even on success.
    const parsed = result.json as { error?: string } | null;
    const reason = parsed?.error ?? result.stderr.trim() ?? "unknown failure";
    throw new CapCutError(`capcut ${command} failed: ${reason}`, {
      command,
      stderr: result.stderr,
      status: result.status,
    });
  }

  if (result.json === null) {
    throw new CapCutError(`capcut ${command} returned no JSON`, {
      command,
      stderr: result.stderr,
      status: result.status,
    });
  }

  return result.json;
}

// ---------------------------------------------------------------------------
// Shapes of the upstream JSON we depend on. Deliberately partial: we declare only
// the fields we read, so an additive upstream change cannot break the build.
// ---------------------------------------------------------------------------

export type ProjectListing = {
  ok: boolean;
  count: number;
  projects: Array<{ folder: string; path: string; mtime: string; root: string }>;
};

export type ProjectInfo = {
  id: string;
  name: string;
  duration_us: number;
  fps: number;
  width: number;
  height: number;
  tracks: number;
  segments: number;
  platform: string;
  material_summary: Array<{ type: string; count: number }>;
};

export type VersionReport = {
  app: string;
  app_source: string;
  app_version: string;
  os: string;
  schema: { schema_int: number; new_version_field: string | null; mask_field: string };
  support: {
    status: "supported" | "untested" | "known-broken";
    evidence: string;
    write_guard: string;
    beyond_known_range: boolean;
    notes: string[];
  };
};

export type DiagnoseReport = {
  ok: boolean;
  canonical: string;
  version: string;
  modern_storage: boolean;
  diverged: boolean;
  layout: string;
  write_guard: string;
  editor_running: string[];
  next_actions: string[];
  candidates: Array<{
    file: string;
    exists: boolean;
    parseable_timeline: boolean;
    tracks?: number;
    segments?: number;
    timeline_hash: string | null;
  }>;
};

export type LintReport = {
  ok: boolean;
  summary: { errors: number; warnings: number; info: number; total: number };
  issues: Array<{ severity: string; code?: string; message: string }>;
};

export type TrackSummary = {
  index: number;
  id: string;
  type: string;
  name: string;
  segments: number;
  duration_us: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
};

export type TextEntry = {
  id: string;
  start_us: number;
  duration_us: number;
  text: string;
};

// ---------------------------------------------------------------------------
// Read-only operations
// ---------------------------------------------------------------------------

export const listProjects = (): ProjectListing => run<ProjectListing>("projects");

export const projectInfo = (project: string): ProjectInfo =>
  run<ProjectInfo>("info", { project });

export const detectVersion = (project: string): VersionReport =>
  run<VersionReport>("version", { project });

export const diagnose = (project: string): DiagnoseReport =>
  run<DiagnoseReport>("diagnose", { project });

/** `lint` exits 2 when it finds errors — that is a result, not a crash. */
export const lint = (project: string): LintReport =>
  run<LintReport>("lint", { project, allowExitCodes: [2] });

export const listTracks = (project: string): TrackSummary[] =>
  run<TrackSummary[]>("tracks", { project });

export const listTexts = (project: string): TextEntry[] =>
  run<TextEntry[]>("texts", { project });
