import { spawnSync } from "node:child_process";
import { diagnose, detectVersion, lint } from "../capcut/adapter.js";

/**
 * The gate every write goes through.
 *
 * Verified on CapCut 9.1 (see GATE0-FINDINGS.md): editing an existing project works,
 * and `capcut-cli` keeps `draft_content.json` and the `template-2.tmp` mirror in sync.
 * The failure modes worth refusing on are all detectable up front, so we detect them
 * instead of discovering them inside someone's project.
 */

export type Verdict = "ok" | "warn" | "refuse";

export type CompatibilityReport = {
  verdict: Verdict;
  /** Human-readable reasons, most important first. */
  reasons: string[];
  app: { name: string; version: string; source: string };
  storage: {
    canonical: string;
    modernStorage: boolean;
    /** True when mirrors disagree — a CLI write reconciles them. */
    diverged: boolean;
  };
  editorRunning: string[];
  integrity: { errors: number; warnings: number };
  tools: { ffmpeg: boolean; ffprobe: boolean };
};

/**
 * Probe without `shell: true` — with a shell Node concatenates argv instead of
 * escaping it, and it emits DEP0190. Windows resolves `.exe` from PATH natively, so
 * the shell buys nothing here.
 */
const hasBinary = (name: string): boolean => {
  try {
    return spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};

export function checkCompatibility(project: string): CompatibilityReport {
  const version = detectVersion(project);
  const storage = diagnose(project);
  const integrity = lint(project);

  const reasons: string[] = [];
  let verdict: Verdict = "ok";

  const refuse = (reason: string) => {
    reasons.unshift(reason);
    verdict = "refuse";
  };
  const warn = (reason: string) => {
    reasons.push(reason);
    if (verdict === "ok") verdict = "warn";
  };

  // JianYing ≥6.0 encrypts the draft on save; round-trip editing is impossible there.
  if (version.app_source !== "cc") {
    refuse(
      `Only CapCut International is supported (app_source "cc"); this draft reports "${version.app_source}".`,
    );
  }

  if (storage.write_guard !== "ok") {
    refuse(`Upstream write guard refuses this version: ${storage.write_guard}.`);
  }

  // The editor holds the project in memory and overwrites the file on close, so a
  // write now would be silently discarded later.
  if (storage.editor_running.length > 0) {
    refuse(`${storage.editor_running.join(", ")} is running — close the editor before writing.`);
  }

  if (integrity.summary.errors > 0) {
    refuse(
      `Project already has ${integrity.summary.errors} integrity error(s); fix them before writing (capcut lint --fix).`,
    );
  }

  if (version.support.status === "untested") {
    warn(
      `CapCut ${version.app_version} has no upstream fixture (${version.support.evidence} evidence) — verified working here, but treat as untested.`,
    );
  }

  if (storage.diverged) {
    warn("Storage mirrors disagree; the next write will reconcile them.");
  }

  if (integrity.summary.warnings > 0) {
    warn(`Project has ${integrity.summary.warnings} lint warning(s).`);
  }

  const tools = { ffmpeg: hasBinary("ffmpeg"), ffprobe: hasBinary("ffprobe") };
  if (!tools.ffprobe) {
    warn("ffprobe not found — media durations must be supplied explicitly when adding clips.");
  }
  if (!tools.ffmpeg) {
    warn("ffmpeg not found — overlay rendering will not work.");
  }

  if (verdict === "ok" && reasons.length === 0) {
    reasons.push(`CapCut ${version.app_version} project is writable; storage is consistent.`);
  }

  return {
    verdict,
    reasons,
    app: { name: version.app, version: version.app_version, source: version.app_source },
    storage: {
      canonical: storage.canonical,
      modernStorage: storage.modern_storage,
      diverged: storage.diverged,
    },
    editorRunning: storage.editor_running,
    integrity: { errors: integrity.summary.errors, warnings: integrity.summary.warnings },
    tools,
  };
}
