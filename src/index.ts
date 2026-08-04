#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CAPTION_PRESETS, restyleCaptions } from "./workflows/captions.js";
import { checkCompatibility } from "./workflows/compatibility.js";
import { inspectProject, projects } from "./workflows/inspect.js";
import { addOverlay, composeOverlay } from "./workflows/overlays.js";
import { renderOverlay } from "./remotion/bridge.js";
import { importSubtitles } from "./workflows/subtitles.js";

/**
 * capcut-mcp — independent, unofficial. Not affiliated with ByteDance.
 *
 * v1 is read-only on purpose: prove the adapter against real projects before any tool
 * is allowed to write into someone's timeline.
 */

const server = new McpServer({ name: "capcut-mcp", version: "0.1.0" });

/**
 * Turns failures into a tool result the model can act on, not a stack trace.
 *
 * A refusal ("close the editor first") is a normal outcome and must read as one —
 * labelling it "unexpected" would push a model to retry instead of fixing the cause.
 * Only a non-Error throw is genuinely unexpected.
 */
const asToolResult = (fn: () => unknown) => {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn(), null, 2) }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unexpected failure: ${String(error)}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
};

server.registerTool(
  "list_projects",
  {
    title: "List CapCut projects",
    description:
      "Lists CapCut projects found in the local draft store, with folder, path and last-modified time.",
    inputSchema: {},
  },
  async () => asToolResult(() => projects()),
);

server.registerTool(
  "inspect_project",
  {
    title: "Inspect a CapCut project",
    description:
      "Reads a project: duration, resolution, tracks, subtitles as readable text, and which material buckets are populated. Read-only.",
    inputSchema: {
      project: z
        .string()
        .describe("Path to the project folder or its draft_content.json"),
    },
  },
  async ({ project }) => asToolResult(() => inspectProject(project)),
);

server.registerTool(
  "check_compatibility",
  {
    title: "Check whether a project is safe to write",
    description:
      "Verdict (ok / warn / refuse) before any modification: CapCut vs JianYing, upstream write guard, whether the editor is running, storage-mirror agreement, existing lint errors, and availability of ffmpeg/ffprobe. Run this before writing.",
    inputSchema: {
      project: z
        .string()
        .describe("Path to the project folder or its draft_content.json"),
    },
  },
  async ({ project }) => asToolResult(() => checkCompatibility(project)),
);

const styleSchema = z
  .object({
    fontSize: z.number().optional(),
    color: z.string().optional().describe("#RRGGBB"),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    alpha: z.number().min(0).max(1).optional().describe("Whole-caption opacity"),
    border: z
      .object({ width: z.number().optional(), color: z.string().optional(), alpha: z.number().optional() })
      .optional()
      .describe("Outline/stroke"),
    shadow: z
      .object({
        enabled: z.boolean().optional(),
        color: z.string().optional(),
        alpha: z.number().optional(),
        angle: z.number().optional().describe("Degrees"),
        distance: z.number().optional(),
        smoothing: z.number().optional().describe("Blur"),
      })
      .optional(),
    background: z
      .object({
        color: z.string().optional(),
        alpha: z.number().optional(),
        roundRadius: z.number().optional(),
        horizontalOffset: z.number().optional(),
        verticalOffset: z.number().optional(),
      })
      .optional()
      .describe("Plate behind the text"),
  })
  .optional();

server.registerTool(
  "restyle_captions",
  {
    title: "Apply one caption style across the project",
    description:
      `Applies one style — outline, shadow, background plate, opacity, size, colour, weight — and optionally an entrance animation to every caption at once. This is the job editors otherwise do by hand on every video. Presets: ${Object.keys(CAPTION_PRESETS).join(", ")}. Animation slugs come from 'capcut enums --text-intros' (typewriter, pop-up, glitch, fade-in, …). NOT supported upstream: font family and on-screen position — those stay manual. Requires CapCut to be closed; use dryRun to preview.`,
    inputSchema: {
      project: z.string().describe("Path to the project folder or its draft_content.json"),
      preset: z.string().optional().describe(`One of: ${Object.keys(CAPTION_PRESETS).join(", ")}`),
      style: styleSchema,
      animation: z
        .object({
          intro: z.string().optional().describe("Slug from 'capcut enums --text-intros'"),
          introDurationSeconds: z.number().optional(),
          outro: z.string().optional(),
          outroDurationSeconds: z.number().optional(),
        })
        .optional(),
      matching: z.string().optional().describe("Only captions containing this substring"),
      dryRun: z.boolean().optional().describe("Report what would change without writing"),
    },
  },
  async (args) => asToolResult(() => restyleCaptions(args)),
);

server.registerTool(
  "import_subtitles",
  {
    title: "Import an SRT as a styled caption track",
    description:
      `Turns an SRT file — or raw SRT text — into a text track with one segment per cue, styled in the same pass. Presets: ${Object.keys(CAPTION_PRESETS).join(", ")}. Keyword highlighting colours chosen words inside every caption (whole-word, case-insensitive), which editors otherwise do by hand. Byte offsets are correct for Cyrillic, Uzbek and emoji. Requires CapCut to be closed.`,
    inputSchema: {
      project: z.string().describe("Path to the project folder or its draft_content.json"),
      path: z.string().optional().describe("Path to an .srt file"),
      content: z.string().optional().describe("Raw SRT text, instead of a file"),
      trackName: z.string().optional().describe("Defaults to \"subtitles\""),
      timeOffsetSeconds: z.number().optional().describe("Shifts every cue"),
      preset: z.string().optional().describe(`One of: ${Object.keys(CAPTION_PRESETS).join(", ")}`),
      style: styleSchema,
      highlight: z
        .object({
          words: z.array(z.string()).describe("Whole words to emphasise"),
          color: z.string().optional().describe("#RRGGBB for the emphasised words"),
          fontSize: z.number().optional(),
        })
        .optional(),
      colorCycle: z
        .array(z.string())
        .optional()
        .describe("Rotates the base colour cue by cue, e.g. two alternating brand colours"),
    },
  },
  async (args) => asToolResult(() => importSubtitles(args)),
);

const overlayShape = {
  text: z.string().describe("Headline"),
  subtitle: z.string().optional(),
  kind: z
    .enum(["lower-third", "title-card", "callout"])
    .optional()
    .describe("lower-third: name bar, bottom left. title-card: centred statement. callout: pill badge."),
  accentColor: z.string().optional().describe("#RRGGBB, defaults to #C6FF34"),
  textColor: z.string().optional().describe("#RRGGBB, defaults to #FFFFFF"),
  width: z.number().optional().describe("Defaults to 1080"),
  height: z.number().optional().describe("Defaults to 1920"),
  fps: z.number().optional().describe("Defaults to 30"),
  durationSeconds: z.number().optional().describe("Defaults to 3"),
  exitAtSeconds: z.number().optional().describe("When the element animates out"),
};

server.registerTool(
  "render_overlay",
  {
    title: "Render a transparent motion-graphics overlay",
    description:
      "Renders an animated overlay with a real alpha channel (ProRes 4444) using Remotion — motion graphics CapCut cannot author itself. Returns the file path; place it with add_overlay. Requires ffmpeg. Rendering takes tens of seconds.",
    inputSchema: {
      ...overlayShape,
      outputPath: z.string().optional().describe("Absolute .mov path; defaults to <package>/out/"),
    },
  },
  async (args) => asToolResult(() => renderOverlay(args)),
);

server.registerTool(
  "add_overlay",
  {
    title: "Place a rendered overlay on the timeline",
    description:
      "Adds an already-rendered clip to a CapCut project on its own track. Requires CapCut to be closed.",
    inputSchema: {
      project: z.string().describe("Path to the project folder or its draft_content.json"),
      file: z.string().describe("Absolute path to the rendered overlay"),
      startSeconds: z.number(),
      durationSeconds: z.number().optional(),
      trackName: z.string().optional().describe("Defaults to \"overlays\""),
    },
  },
  async (args) => asToolResult(() => addOverlay(args)),
);

server.registerTool(
  "compose_overlay",
  {
    title: "Render an overlay and place it in one step",
    description:
      "Renders a transparent overlay and adds it to the project at the given time. The common case — use render_overlay separately when the same graphic is reused across projects.",
    inputSchema: {
      ...overlayShape,
      project: z.string().describe("Path to the project folder or its draft_content.json"),
      startSeconds: z.number().describe("Where on the timeline the overlay begins"),
      trackName: z.string().optional(),
    },
  },
  async (args) => asToolResult(() => composeOverlay(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
