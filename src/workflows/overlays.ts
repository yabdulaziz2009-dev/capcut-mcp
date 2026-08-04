import { run } from "../capcut/adapter.js";
import { renderOverlay, type RenderOverlayRequest, type RenderOverlayResult } from "../remotion/bridge.js";
import { checkCompatibility } from "./compatibility.js";

/**
 * Render an overlay, then place it on a CapCut timeline.
 *
 * Kept as two steps rather than one so the render can be reviewed — and reused across
 * several projects — before anything is written into a timeline.
 */

export type AddOverlayRequest = {
  project: string;
  /** Path to a rendered overlay (`render_overlay` returns one). */
  file: string;
  startSeconds: number;
  durationSeconds?: number;
  /** Track to place it on. A distinct name keeps overlays off the main video track. */
  trackName?: string;
};

export type AddOverlayResult = {
  file: string;
  startSeconds: number;
  trackName: string;
  notes: string[];
};

export function addOverlay(request: AddOverlayRequest): AddOverlayResult {
  const compatibility = checkCompatibility(request.project);
  if (compatibility.verdict === "refuse") {
    throw new Error(`Refusing to write: ${compatibility.reasons.join(" ")}`);
  }

  const notes = [...compatibility.reasons];
  const trackName = request.trackName ?? "overlays";

  const args: Array<string | number> = [request.file, request.startSeconds];
  if (request.durationSeconds !== undefined) args.push(request.durationSeconds);
  args.push("--track-name", trackName);

  run("add-video", { project: request.project, args });

  // Confirmed compositing correctly on CapCut 9.1.0 / Windows: the overlay showed the
  // footage through its transparent areas. Other builds are unverified, so the caller
  // still gets told what a failure would look like.
  notes.push(
    "ProRes 4444 alpha composites correctly on CapCut 9.1 (Windows), verified. On other builds, a black box instead of transparency means re-rendering as WebM/VP9.",
  );

  return { file: request.file, startSeconds: request.startSeconds, trackName, notes };
}

export type ComposeOverlayRequest = RenderOverlayRequest & {
  project: string;
  startSeconds: number;
  trackName?: string;
};

export type ComposeOverlayResult = {
  render: RenderOverlayResult;
  placement: AddOverlayResult;
};

/** Render and place in one call — the common case. */
export function composeOverlay(request: ComposeOverlayRequest): ComposeOverlayResult {
  const { project, startSeconds, trackName, ...renderRequest } = request;

  // Check before spending minutes on a render that could not be written anyway.
  const compatibility = checkCompatibility(project);
  if (compatibility.verdict === "refuse") {
    throw new Error(`Refusing to write: ${compatibility.reasons.join(" ")}`);
  }

  const render = renderOverlay(renderRequest);
  const placement = addOverlay({
    project,
    file: render.path,
    startSeconds,
    durationSeconds: render.durationFrames / render.fps,
    trackName,
  });

  return { render, placement };
}
