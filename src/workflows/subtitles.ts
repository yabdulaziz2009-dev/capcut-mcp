import { existsSync } from "node:fs";
import { run } from "../capcut/adapter.js";
import { CAPTION_PRESETS, resolveStyle, type CaptionStyle } from "./captions.js";
import { checkCompatibility } from "./compatibility.js";

/**
 * SRT → a styled text track.
 *
 * Styling is passed straight to `capcut import-srt` rather than applied in a second
 * pass, because — unlike `text-style` — its `--font-size`/`--color` flags are actually
 * honoured (GATE0-FINDINGS.md §6). One command, one write.
 *
 * Keyword highlighting is the reason this is not just "load a file": editors colour the
 * emphasised word in every caption by hand. Upstream matches whole words
 * case-insensitively and splits the style spans on exact UTF-16 boundaries, verified
 * here against Cyrillic, Uzbek `ʻ` and emoji.
 */

export type SubtitleHighlight = {
  /** Whole words to emphasise, matched case-insensitively. */
  words: string[];
  /** `#RRGGBB` for the emphasised words. */
  color?: string;
  fontSize?: number;
};

export type ImportSubtitlesRequest = {
  project: string;
  /** Path to an .srt file. Mutually exclusive with `content`. */
  path?: string;
  /** Raw SRT text, for subtitles generated on the fly. */
  content?: string;
  trackName?: string;
  /** Shifts every cue, for footage that does not start at zero. */
  timeOffsetSeconds?: number;
  preset?: string;
  style?: CaptionStyle;
  highlight?: SubtitleHighlight;
  /** Rotates the base colour cue by cue. */
  colorCycle?: string[];
};

export type ImportSubtitlesResult = {
  cues: number;
  trackName: string;
  keywordMatches?: number;
  first?: { startSeconds: number; text: string };
  last?: { startSeconds: number; text: string };
  style: CaptionStyle;
  notes: string[];
};

type ImportResponse = {
  ok: boolean;
  cues: number;
  track_name: string;
  keyword_matches?: number;
  first?: { start_us: number; text: string };
  last?: { start_us: number; text: string };
};

/**
 * `import-srt` honours these, so the whole style travels with the import.
 * Position (`--x`/`--y`/`--align`) is accepted by the command but has no effect
 * anywhere in this toolchain, so it is deliberately not exposed.
 */
const styleToImportArgs = (style: CaptionStyle): Array<string | number> => {
  const args: Array<string | number> = [];
  const push = (flag: string, value: unknown) => {
    if (value !== undefined) args.push(flag, value as string | number);
  };

  push("--font-size", style.fontSize);
  push("--color", style.color);
  push("--alpha", style.alpha);

  push("--border-width", style.border?.width);
  push("--border-color", style.border?.color);
  push("--border-alpha", style.border?.alpha);

  if (style.shadow?.enabled === true) args.push("--shadow");
  if (style.shadow?.enabled === false) args.push("--no-shadow");
  push("--shadow-color", style.shadow?.color);
  push("--shadow-alpha", style.shadow?.alpha);
  push("--shadow-angle", style.shadow?.angle);
  push("--shadow-distance", style.shadow?.distance);
  push("--shadow-smoothing", style.shadow?.smoothing);

  push("--bg-color", style.background?.color);
  push("--bg-alpha", style.background?.alpha);
  push("--bg-round-radius", style.background?.roundRadius);
  push("--bg-h-offset", style.background?.horizontalOffset);
  push("--bg-v-offset", style.background?.verticalOffset);

  return args;
};

const seconds = (us: number): number => Math.round((us / 1_000_000) * 100) / 100;

export function importSubtitles(request: ImportSubtitlesRequest): ImportSubtitlesResult {
  if (!request.path && !request.content) {
    throw new Error("Supply either `path` to an .srt file or `content` with raw SRT text.");
  }
  if (request.path && request.content) {
    throw new Error("Supply `path` or `content`, not both.");
  }
  if (request.path && !existsSync(request.path)) {
    throw new Error(`SRT file not found: ${request.path}`);
  }
  if (request.preset && !CAPTION_PRESETS[request.preset]) {
    throw new Error(
      `Unknown preset "${request.preset}". Available: ${Object.keys(CAPTION_PRESETS).join(", ")}`,
    );
  }

  const compatibility = checkCompatibility(request.project);
  if (compatibility.verdict === "refuse") {
    throw new Error(`Refusing to write: ${compatibility.reasons.join(" ")}`);
  }
  const notes = [...compatibility.reasons];

  const style = resolveStyle(request.preset, request.style);
  const trackName = request.trackName ?? "subtitles";

  // "-" makes upstream read the SRT from stdin, so generated subtitles never need a
  // temporary file on disk.
  const source = request.path ?? "-";
  const args: Array<string | number> = [source, "--track-name", trackName];

  if (request.timeOffsetSeconds !== undefined) {
    args.push("--time-offset", request.timeOffsetSeconds);
  }
  args.push(...styleToImportArgs(style));

  if (request.highlight && request.highlight.words.length > 0) {
    args.push("--highlight-words", request.highlight.words.join(","));
    if (request.highlight.color) args.push("--keyword-color", request.highlight.color);
    if (request.highlight.fontSize) args.push("--keyword-size", request.highlight.fontSize);
  }
  if (request.colorCycle && request.colorCycle.length > 0) {
    args.push("--color-cycle", request.colorCycle.join(","));
  }

  const response = run<ImportResponse>("import-srt", {
    project: request.project,
    args,
    input: request.content,
  });

  if (request.highlight?.words.length && !response.keyword_matches) {
    notes.push(
      "No keyword matched — matching is whole-word and case-insensitive, so partial words and different inflections will not hit.",
    );
  }

  return {
    cues: response.cues,
    trackName: response.track_name,
    keywordMatches: response.keyword_matches,
    first: response.first
      ? { startSeconds: seconds(response.first.start_us), text: response.first.text }
      : undefined,
    last: response.last
      ? { startSeconds: seconds(response.last.start_us), text: response.last.text }
      : undefined,
    style,
    notes,
  };
}
