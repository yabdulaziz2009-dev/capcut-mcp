import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Renders an overlay with a real alpha channel — the thing CapCut cannot author.
 *
 * Editors leave CapCut for code-driven motion graphics and come back with a
 * transparent clip to composite. This bridge is that round trip, automated.
 *
 * The Remotion project is a sibling package rather than a dependency of the MCP server:
 * it pulls in a browser and hundreds of megabytes, and only this one tool needs it.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** `src/remotion/` → `<package root>/remotion`, and the same from `dist/remotion/`. */
const projectRoot = resolve(here, "..", "..", "remotion");

export type OverlayKind = "lower-third" | "title-card" | "callout";

export type RenderOverlayRequest = {
  text: string;
  subtitle?: string;
  kind?: OverlayKind;
  accentColor?: string;
  textColor?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  /** Seconds before the element animates out. Defaults to just before the end. */
  exitAtSeconds?: number;
  /** Absolute path for the .mov. Defaults to <package>/out/overlay-<timestamp>.mov */
  outputPath?: string;
};

export type RenderOverlayResult = {
  path: string;
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  codec: string;
  hasAlpha: true;
  renderSeconds: number;
};

export class OverlayRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverlayRenderError";
  }
}

const assertReady = (): void => {
  if (!existsSync(projectRoot)) {
    throw new OverlayRenderError(`Overlay project missing at ${projectRoot}.`);
  }
  if (!existsSync(join(projectRoot, "node_modules"))) {
    throw new OverlayRenderError(
      `Overlay dependencies not installed. Run: npm install --prefix "${projectRoot}"`,
    );
  }
};

export type OverlayTiming = {
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  exitAtFrame: number;
};

/**
 * Turns seconds into the frame counts Remotion needs. Pure, so the arithmetic is
 * testable without spawning a renderer.
 */
export function resolveTiming(request: RenderOverlayRequest): OverlayTiming {
  const fps = request.fps ?? 30;
  // Two frames minimum: a single-frame video is not a video.
  const durationFrames = Math.max(2, Math.round((request.durationSeconds ?? 3) * fps));
  // Leave room for the exit animation when the caller does not choose a moment, and
  // never let an explicit exit land past the end of the clip.
  const exitAtFrame =
    request.exitAtSeconds !== undefined
      ? Math.min(Math.round(request.exitAtSeconds * fps), durationFrames - 1)
      : Math.max(1, durationFrames - 15);

  return {
    width: request.width ?? 1080,
    height: request.height ?? 1920,
    fps,
    durationFrames,
    exitAtFrame: Math.max(1, exitAtFrame),
  };
}

export function renderOverlay(request: RenderOverlayRequest): RenderOverlayResult {
  assertReady();

  const { width, height, fps, durationFrames, exitAtFrame } = resolveTiming(request);

  const outputPath =
    request.outputPath ?? join(projectRoot, "..", "out", `overlay-${Date.now()}.mov`);
  mkdirSync(dirname(outputPath), { recursive: true });

  const props = JSON.stringify({
    text: request.text,
    subtitle: request.subtitle ?? "",
    kind: request.kind ?? "lower-third",
    accentColor: request.accentColor ?? "#C6FF34",
    textColor: request.textColor ?? "#FFFFFF",
    exitAtFrame,
    // The composition resizes itself from this in calculateMetadata; without it a
    // render longer than the declared default fails on the frame range.
    durationInFrames: durationFrames,
  });

  // Invoke the CLI's JS entry with Node directly. `npx` on Windows is a `.cmd`, and
  // Node refuses to spawn one without a shell (CVE-2024-27980) — while a shell would
  // mangle the JSON props, which carry Cyrillic and quotes.
  const cliEntry = join(projectRoot, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!existsSync(cliEntry)) {
    throw new OverlayRenderError(`Remotion CLI not found at ${cliEntry}.`);
  }

  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      cliEntry,
      "render",
      "Overlay",
      outputPath,
      `--props=${props}`,
      `--width=${width}`,
      `--height=${height}`,
      `--frames=0-${durationFrames - 1}`,
      // Alpha is not optional here: an overlay without it is just a black rectangle.
      "--codec=prores",
      "--prores-profile=4444",
      "--image-format=png",
      "--pixel-format=yuva444p10le",
    ],
    { cwd: projectRoot, encoding: "utf-8", timeout: 15 * 60_000 },
  );

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "no output").trim().slice(0, 800);
    throw new OverlayRenderError(`Remotion render failed: ${detail}`);
  }
  if (!existsSync(outputPath)) {
    throw new OverlayRenderError(`Remotion reported success but ${outputPath} does not exist.`);
  }

  return {
    path: outputPath,
    width,
    height,
    fps,
    durationFrames,
    codec: "prores-4444",
    hasAlpha: true,
    renderSeconds: Math.round(((Date.now() - startedAt) / 1000) * 10) / 10,
  };
}
