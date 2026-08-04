import { listProjects, listTexts, listTracks, projectInfo } from "../capcut/adapter.js";

/**
 * Read-only views of a project, shaped for a model rather than for a JSON parser:
 * seconds instead of microseconds, subtitles as readable lines, and the size of the
 * timeline stated plainly.
 */

const seconds = (us: number): number => Math.round((us / 1_000_000) * 100) / 100;

export type ProjectSummary = {
  folder: string;
  path: string;
  modified: string;
};

export function projects(): ProjectSummary[] {
  return listProjects().projects.map((p) => ({
    folder: p.folder,
    path: p.path,
    modified: p.mtime,
  }));
}

export type Inspection = {
  name: string;
  durationSeconds: number;
  fps: number;
  resolution: string;
  trackCount: number;
  segmentCount: number;
  platform: string;
  tracks: Array<{
    index: number;
    type: string;
    segments: number;
    durationSeconds: number;
    muted: boolean;
    hidden: boolean;
  }>;
  subtitles: Array<{ startSeconds: number; durationSeconds: number; text: string }>;
  /** Material buckets that actually hold something — the rest of the 60+ are empty. */
  materials: Array<{ type: string; count: number }>;
  warnings: string[];
};

export function inspectProject(project: string): Inspection {
  const info = projectInfo(project);
  const tracks = listTracks(project);
  const texts = listTexts(project);

  const warnings: string[] = [];

  // A project can hold segments while reporting zero length — `capcut init` produces
  // exactly that, and CapCut then opens it with nothing to play (GATE0-FINDINGS.md).
  if (info.duration_us === 0 && info.segments > 0) {
    warnings.push(
      "Timeline duration is 0 although segments exist — CapCut will open this project with nothing to play.",
    );
  }
  if (!info.id) {
    warnings.push("Project id is empty; CapCut may refuse to open this draft.");
  }

  return {
    name: info.name,
    durationSeconds: seconds(info.duration_us),
    fps: info.fps,
    resolution: `${info.width}x${info.height}`,
    trackCount: info.tracks,
    segmentCount: info.segments,
    platform: info.platform,
    tracks: tracks.map((t) => ({
      index: t.index,
      type: t.type,
      segments: t.segments,
      durationSeconds: seconds(t.duration_us),
      muted: t.muted,
      hidden: t.hidden,
    })),
    subtitles: texts.map((t) => ({
      startSeconds: seconds(t.start_us),
      durationSeconds: seconds(t.duration_us),
      text: t.text,
    })),
    materials: info.material_summary,
    warnings,
  };
}
