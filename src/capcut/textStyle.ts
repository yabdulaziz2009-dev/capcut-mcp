import { loadDraft, saveDraft, type Draft, type MaterialText } from "capcut-cli";

/**
 * Bulk caption styling applied in memory, then committed with a single `saveDraft`.
 *
 * ## Why this exists, given the "never touch the draft yourself" rule
 *
 * Driving `capcut text-style` / `text-ranges` once per caption measured **1.96 s per
 * caption** — 55 s for 28 captions, and a real short carries 100–200. Each call spawns
 * a process, rewrites both storage mirrors and appends a history snapshot; one styling
 * pass left 40 snapshots and 3 MB of history behind.
 *
 * So the rule is narrowed rather than broken: we still never parse or serialise the
 * draft ourselves. `loadDraft` gives a typed graph, we mutate text materials in memory,
 * and `saveDraft` performs the write — keeping the version guard, editor check, backup,
 * atomic temp→fsync→rename and the `template-2.tmp` mirror sync.
 *
 * What we take on is knowledge of the text-material field names. They are stable across
 * the 7.8 and 9.1 drafts observed, and `lint` verifies the result after every write.
 */

/** `#RRGGBB` → the 0..1 triple CapCut stores in `content.styles[].fill`. Exported for tests. */
export const hexToRgb01 = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Expected #RRGGBB colour, got "${hex}"`);
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
};

/**
 * UTF-16LE byte length — the unit CapCut uses for style ranges.
 *
 * Not character count: Cyrillic is 2 bytes per character and an emoji is 4. Getting
 * this wrong silently corrupts the styling of every non-Latin caption.
 */
export const utf16Bytes = (text: string): number => Buffer.from(text, "utf16le").length;

export type MaterialStyle = {
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  alpha?: number;
  alignment?: "left" | "center" | "right";
  border?: { width?: number; color?: string; alpha?: number };
  shadow?: {
    enabled?: boolean;
    color?: string;
    alpha?: number;
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

/** CapCut stores alignment as an integer on the material. */
const ALIGNMENT_CODE = { left: 0, center: 1, right: 2 } as const;

type TextContent = {
  text: string;
  styles?: Array<Record<string, unknown>>;
};

/**
 * Applies the style to one text material, both on the material itself (outline,
 * shadow, plate) and inside its JSON-encoded `content` (colour, size, weight).
 *
 * Returns true when a multi-range styling was collapsed, so the caller can warn: a
 * karaoke-style per-word highlight cannot survive a single uniform style.
 */
const applyToMaterial = (material: MaterialText, style: MaterialStyle): boolean => {
  const target = material as unknown as Record<string, unknown>;

  if (style.alpha !== undefined) target.global_alpha = style.alpha;
  if (style.alignment !== undefined) target.alignment = ALIGNMENT_CODE[style.alignment];

  if (style.border) {
    if (style.border.width !== undefined) {
      target.border_width = style.border.width;
      target.has_border = style.border.width > 0;
    }
    if (style.border.color !== undefined) target.border_color = style.border.color;
    if (style.border.alpha !== undefined) target.border_alpha = style.border.alpha;
  }

  if (style.shadow) {
    if (style.shadow.enabled !== undefined) target.has_shadow = style.shadow.enabled;
    if (style.shadow.color !== undefined) target.shadow_color = style.shadow.color;
    if (style.shadow.alpha !== undefined) target.shadow_alpha = style.shadow.alpha;
    if (style.shadow.angle !== undefined) target.shadow_angle = style.shadow.angle;
    if (style.shadow.distance !== undefined) target.shadow_distance = style.shadow.distance;
    if (style.shadow.smoothing !== undefined) target.shadow_smoothing = style.shadow.smoothing;
  }

  if (style.background) {
    if (style.background.color !== undefined) {
      target.background_color = style.background.color;
      // A plate with no style set renders as nothing regardless of colour.
      target.background_style = 1;
    }
    if (style.background.alpha !== undefined) target.background_alpha = style.background.alpha;
    if (style.background.roundRadius !== undefined) {
      target.background_round_radius = style.background.roundRadius;
    }
    if (style.background.horizontalOffset !== undefined) {
      target.background_horizontal_offset = style.background.horizontalOffset;
    }
    if (style.background.verticalOffset !== undefined) {
      target.background_vertical_offset = style.background.verticalOffset;
    }
  }

  // Mirrored onto the material because CapCut reads these for its own UI, while the
  // renderer honours content.styles — they must not disagree.
  if (style.color !== undefined) target.text_color = style.color;
  if (style.fontSize !== undefined) target.font_size = style.fontSize;
  if (style.underline !== undefined) target.underline = style.underline;

  const touchesText =
    style.color !== undefined ||
    style.fontSize !== undefined ||
    style.bold !== undefined ||
    style.italic !== undefined ||
    style.underline !== undefined;

  if (!touchesText) return false;

  const content = JSON.parse(material.content) as TextContent;
  const text = content.text ?? "";
  const existing = content.styles ?? [];
  const collapsed = existing.length > 1;
  const base = existing[0] ?? {};

  const previousFill = (base.fill ?? {}) as {
    alpha?: number;
    content?: { solid?: { alpha?: number; color?: [number, number, number] } };
  };
  const previousSolid = previousFill.content?.solid ?? {};

  const solid = {
    alpha: previousSolid.alpha ?? 1,
    color: style.color ? hexToRgb01(style.color) : (previousSolid.color ?? [1, 1, 1]),
  };

  content.styles = [
    {
      ...base,
      // One uniform style spans the whole caption. Byte offsets, not characters.
      range: [0, utf16Bytes(text)],
      size: style.fontSize ?? base.size ?? 15,
      bold: style.bold ?? base.bold ?? false,
      italic: style.italic ?? base.italic ?? false,
      underline: style.underline ?? base.underline ?? false,
      fill: { alpha: previousFill.alpha ?? 1, content: { render_type: "solid", solid } },
    },
  ];

  material.content = JSON.stringify(content);
  return collapsed;
};

export type BulkStyleResult = {
  styledCount: number;
  /** Captions whose multi-range (karaoke) styling was replaced by one uniform style. */
  collapsedRanges: number;
};

/**
 * Styles every given text segment in one pass and commits a single write.
 *
 * `segmentIds` selects which captions to touch; materials are resolved through the
 * segments so a material shared by two segments is still styled once.
 */
export function applyStyleToSegments(
  projectPath: string,
  segmentIds: string[],
  style: MaterialStyle,
): BulkStyleResult {
  // `filePath` is the canonical target upstream picked — on CapCut 9.x that is
  // `template-2.tmp`, not `draft_content.json`. Handing it straight back to
  // `saveDraft` is what keeps every storage mirror in sync.
  const { draft, filePath } = loadDraft(projectPath) as { draft: Draft; filePath: string };
  const wanted = new Set(segmentIds);

  const materialIds = new Set<string>();
  for (const track of draft.tracks) {
    for (const segment of track.segments ?? []) {
      if (wanted.has(segment.id)) materialIds.add(segment.material_id);
    }
  }

  let styledCount = 0;
  let collapsedRanges = 0;

  for (const material of (draft.materials.texts ?? []) as MaterialText[]) {
    if (!materialIds.has(material.id)) continue;
    if (applyToMaterial(material, style)) collapsedRanges += 1;
    styledCount += 1;
  }

  if (styledCount > 0) saveDraft(filePath, draft);

  return { styledCount, collapsedRanges };
}
