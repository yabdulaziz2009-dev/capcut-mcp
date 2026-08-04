import { CapCutError, listTexts, run, type LintReport } from "../capcut/adapter.js";
import { applyStyleToSegments } from "../capcut/textStyle.js";
import { checkCompatibility } from "./compatibility.js";

/**
 * Uniform caption styling across a whole project.
 *
 * This is the single most repetitive job observed in professional CapCut workflows:
 * editors set the same stroke, shadow and box on every caption of a video, one segment
 * at a time. It is pure structure — sizes, colours, offsets — so it belongs to the
 * machine.
 *
 * Two upstream commands are needed, because neither covers the whole job:
 *
 * - `text-style` owns outline, shadow, plate and opacity. Its `--font-size`, `--color`,
 *   `--align`, `--x` and `--y` flags are listed in `--help` but **silently ignored**
 *   (verified: the command answers "No styling flags provided" when given only those).
 * - `text-ranges` owns colour, size and weight, applied over a byte-accurate span.
 *
 * Not covered at all: font family (no typeface option upstream, empty font catalogue)
 * and on-screen position. Both stay manual; saying so beats accepting an argument and
 * dropping it.
 */

export type CaptionStyle = {
  /** Applied through `text-ranges` over the whole caption. */
  fontSize?: number;
  /** `#RRGGBB`. Applied through `text-ranges`. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Whole-segment opacity, through `text-style`. */
  alpha?: number;
  border?: { width?: number; color?: string; alpha?: number };
  shadow?: {
    enabled?: boolean;
    color?: string;
    alpha?: number;
    /** Degrees. */
    angle?: number;
    distance?: number;
    smoothing?: number;
  };
  background?: {
    color?: string;
    alpha?: number;
    roundRadius?: number;
    horizontalOffset?: number;
    verticalOffset?: number;
  };
};

export type CaptionAnimation = {
  /** Slug from `capcut enums --text-intros`, e.g. "typewriter", "pop-up", "glitch". */
  intro?: string;
  introDurationSeconds?: number;
  outro?: string;
  outroDurationSeconds?: number;
};

/**
 * Ready-made looks drawn from what editors actually build in the tutorials analysed:
 * short phrases, heavy stroke, black shadow so text survives any background.
 */
export const CAPTION_PRESETS: Record<string, CaptionStyle> = {
  /** White text, thick black outline, soft drop shadow — the shorts default. */
  "bold-outline": {
    color: "#FFFFFF",
    border: { width: 18, color: "#000000", alpha: 1 },
    shadow: { enabled: true, color: "#000000", alpha: 0.7, angle: -45, distance: 8, smoothing: 0.3 },
  },
  /** Text on a rounded dark plate — maximum legibility over busy footage. */
  boxed: {
    color: "#FFFFFF",
    background: { color: "#000000", alpha: 0.65, roundRadius: 24, horizontalOffset: 0.1, verticalOffset: 0.1 },
  },
  /** Brand accent with a dark outline, for emphasis lines rather than every caption. */
  accent: {
    color: "#C6FF34",
    border: { width: 14, color: "#0B0E1A", alpha: 1 },
    shadow: { enabled: true, color: "#000000", alpha: 0.55, angle: -45, distance: 6, smoothing: 0.4 },
  },
};

type StyleArgs = Array<string | number | boolean>;

/** True when the style asks for anything at all. */
const isEmptyStyle = (style: CaptionStyle): boolean =>
  Object.values(style).every((value) =>
    value === undefined ||
    (typeof value === "object" && value !== null && Object.keys(value).length === 0),
  );

const animationToArgs = (animation: CaptionAnimation): StyleArgs => {
  const args: StyleArgs = [];
  if (animation.intro) {
    args.push("--intro", animation.intro);
    if (animation.introDurationSeconds !== undefined) {
      args.push("--intro-duration", animation.introDurationSeconds);
    }
  }
  if (animation.outro) {
    args.push("--outro", animation.outro);
    if (animation.outroDurationSeconds !== undefined) {
      args.push("--outro-duration", animation.outroDurationSeconds);
    }
  }
  return args;
};

export type RestyleRequest = {
  project: string;
  /** Named preset from `CAPTION_PRESETS`, applied before `style`. */
  preset?: keyof typeof CAPTION_PRESETS | string;
  /** Explicit style; overrides the preset field by field. */
  style?: CaptionStyle;
  animation?: CaptionAnimation;
  /** Restrict to captions whose text contains this substring. */
  matching?: string;
  /** Report what would change without writing. */
  dryRun?: boolean;
};

export type RestyleResult = {
  applied: boolean;
  captionsMatched: number;
  captionsStyled: number;
  captions: Array<{ id: string; text: string; startSeconds: number }>;
  style: CaptionStyle;
  animation?: CaptionAnimation;
  integrity?: LintReport["summary"];
  notes: string[];
};

/**
 * Combines a named preset with an explicit style.
 *
 * Explicit fields win one by one, so a preset can be nudged rather than replaced —
 * "bold-outline but yellow" should not lose the outline. Nested groups merge for the
 * same reason, and stay absent when neither side set them: an empty `{}` in the result
 * would read as "styled" downstream when nothing was asked for.
 */
export function resolveStyle(
  preset: string | undefined,
  explicit: CaptionStyle | undefined,
): CaptionStyle {
  const presetStyle = preset ? CAPTION_PRESETS[preset] : undefined;
  if (preset && !presetStyle) {
    throw new Error(
      `Unknown preset "${preset}". Available: ${Object.keys(CAPTION_PRESETS).join(", ")}`,
    );
  }

  const merged: CaptionStyle = { ...presetStyle, ...explicit };

  // Nested groups merge rather than overwrite. Assigning them unconditionally would
  // leave `background: undefined` keys behind, which survive object comparison and
  // clutter the JSON a caller sees — so absent groups stay genuinely absent.
  const groups = ["border", "shadow", "background"] as const;
  for (const group of groups) {
    const a = presetStyle?.[group];
    const b = explicit?.[group];
    if (a || b) {
      merged[group] = { ...a, ...b };
    } else {
      delete merged[group];
    }
  }

  return merged;
}

export function restyleCaptions(request: RestyleRequest): RestyleResult {
  const notes: string[] = [];
  const style = resolveStyle(request.preset, request.style);

  const animationArgs = request.animation ? animationToArgs(request.animation) : [];
  const hasStyle = !isEmptyStyle(style);
  if (!hasStyle && animationArgs.length === 0) {
    throw new Error("Nothing to apply — supply a preset, a style, or an animation.");
  }

  const all = listTexts(request.project);
  const matched = request.matching
    ? all.filter((t) => t.text.includes(request.matching as string))
    : all;

  const captions = matched.map((t) => ({
    id: t.id,
    text: t.text,
    startSeconds: Math.round((t.start_us / 1_000_000) * 100) / 100,
  }));

  if (matched.length === 0) {
    notes.push(
      request.matching
        ? `No captions contain "${request.matching}".`
        : "This project has no text segments.",
    );
    return { applied: false, captionsMatched: 0, captionsStyled: 0, captions, style, notes };
  }

  if (request.dryRun) {
    notes.push(`Dry run — ${matched.length} caption(s) would be restyled.`);
    return {
      applied: false,
      captionsMatched: matched.length,
      captionsStyled: 0,
      captions,
      style,
      animation: request.animation,
      notes,
    };
  }

  // The gate is checked only when actually writing: inspection and dry runs stay
  // usable while CapCut is open.
  const compatibility = checkCompatibility(request.project);
  if (compatibility.verdict === "refuse") {
    throw new Error(`Refusing to write: ${compatibility.reasons.join(" ")}`);
  }
  notes.push(...compatibility.reasons);

  // Styling goes through one in-memory pass and a single write. Per-caption CLI calls
  // measured 1.96 s each — 55 s for 28 captions, and they left 40 history snapshots
  // behind. See src/capcut/textStyle.ts for why the "never touch the draft" rule is
  // narrowed here rather than broken.
  const bulk = hasStyle
    ? applyStyleToSegments(
        request.project,
        matched.map((caption) => caption.id),
        style,
      )
    : { styledCount: 0, collapsedRanges: 0 };
  const styled = hasStyle ? bulk.styledCount : matched.length;

  if (bulk.collapsedRanges > 0) {
    notes.push(
      `${bulk.collapsedRanges} caption(s) had per-word (karaoke) styling, now replaced by one uniform style.`,
    );
  }

  // Animations still go one call per caption: they live on material_animations, which
  // this module does not model, and there are usually few of them.
  let animationsSkipped = 0;
  if (animationArgs.length > 0) {
    for (const caption of matched) {
      try {
        run("text-anim", { project: request.project, args: [caption.id, ...animationArgs] });
      } catch (error) {
        // `text-anim` refuses a second animation of the same kind rather than
        // replacing it, so re-running this tool would otherwise abort partway and
        // leave the project half-styled. Skipping keeps the operation idempotent.
        if (!(error instanceof CapCutError) || !/already has/.test(error.message)) throw error;
        animationsSkipped += 1;
      }
    }
  }

  if (animationsSkipped > 0) {
    notes.push(
      `${animationsSkipped} caption(s) already carried an animation and kept it — upstream cannot replace one, only add.`,
    );
  }

  const integrity = run<LintReport>("lint", {
    project: request.project,
    allowExitCodes: [2],
  }).summary;

  if (integrity.errors > 0) {
    notes.unshift(
      `WARNING: project now reports ${integrity.errors} integrity error(s) — inspect before opening CapCut.`,
    );
  }

  return {
    applied: true,
    captionsMatched: matched.length,
    captionsStyled: styled,
    captions,
    style,
    animation: request.animation,
    integrity,
    notes,
  };
}
