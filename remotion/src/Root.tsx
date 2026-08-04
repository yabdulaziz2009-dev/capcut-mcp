import React from "react";
import { Composition } from "remotion";
import { Overlay, OVERLAY_DEFAULTS, type OverlayProps } from "./Overlay";

/**
 * One composition, driven entirely by props passed at render time (`--props`), so the
 * MCP server never has to generate or edit React code to produce a new overlay.
 *
 * Dimensions and duration are overridden per render with `--width/--height/--frames`.
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Overlay"
    component={Overlay}
    durationInFrames={90}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={OVERLAY_DEFAULTS satisfies OverlayProps}
    // Length travels with the props. Without this the composition stays at its
    // declared 90 frames and any longer render fails with "frame range is not
    // inbetween" — the CLI has no --duration flag to override it.
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames ?? 90,
    })}
  />
);
