import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Motion graphics CapCut cannot author itself.
 *
 * The whole point is the **absence of a background**: no opaque fill anywhere, so the
 * render carries a real alpha channel and drops onto a CapCut timeline as an overlay.
 * A single `backgroundColor` on the root would silently destroy that.
 */

export type OverlayKind = "lower-third" | "title-card" | "callout";

export type OverlayProps = {
  text: string;
  subtitle: string;
  kind: OverlayKind;
  /** Fill of the bar / underline / pill. */
  accentColor: string;
  textColor: string;
  /** Frames the element holds before leaving. */
  exitAtFrame: number;
  /**
   * Total length. Read by `calculateMetadata` so the composition resizes to the
   * requested clip instead of staying at its declared default.
   */
  durationInFrames?: number;
};

export const OVERLAY_DEFAULTS: OverlayProps = {
  text: "Заголовок",
  subtitle: "",
  kind: "lower-third",
  accentColor: "#C6FF34",
  textColor: "#FFFFFF",
  exitAtFrame: 75,
  durationInFrames: 90,
};

/** Shared entrance/exit envelope so every kind leaves the frame the way it entered. */
const useEnvelope = (exitAtFrame: number) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 22, mass: 0.6, stiffness: 150 } });
  const leaveStart = Math.min(exitAtFrame, durationInFrames - 8);
  const leave = interpolate(frame, [leaveStart, leaveStart + 12], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return { frame, enter, leave, opacity: enter * leave };
};

const LowerThird: React.FC<OverlayProps> = ({ text, subtitle, accentColor, textColor, exitAtFrame }) => {
  const { enter, opacity } = useEnvelope(exitAtFrame);
  const slide = interpolate(enter, [0, 1], [-140, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: 96 }}>
      <div style={{ transform: `translateX(${slide}px)`, opacity, display: "flex", gap: 24 }}>
        <div style={{ width: 12, borderRadius: 6, background: accentColor }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBlock: 8 }}>
          <div
            style={{
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 68,
              fontWeight: 800,
              color: textColor,
              letterSpacing: "-0.02em",
              textShadow: "0 8px 32px rgba(0,0,0,0.55)",
            }}
          >
            {text}
          </div>
          {subtitle ? (
            <div
              style={{
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 32,
                fontWeight: 500,
                color: accentColor,
                textShadow: "0 4px 16px rgba(0,0,0,0.5)",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<OverlayProps> = ({ text, subtitle, accentColor, textColor, exitAtFrame }) => {
  const { enter, opacity } = useEnvelope(exitAtFrame);
  const scale = interpolate(enter, [0, 1], [0.86, 1]);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 96 }}>
      <div style={{ transform: `scale(${scale})`, opacity, textAlign: "center" }}>
        <div
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 96,
            fontWeight: 900,
            color: textColor,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            textShadow: "0 10px 40px rgba(0,0,0,0.6)",
          }}
        >
          {text}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 24,
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 36,
              fontWeight: 700,
              color: accentColor,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const Callout: React.FC<OverlayProps> = ({ text, accentColor, exitAtFrame }) => {
  const { enter, opacity } = useEnvelope(exitAtFrame);
  const scale = interpolate(enter, [0, 1], [0.7, 1]);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          background: accentColor,
          color: "#0B0E1A",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 44,
          fontWeight: 800,
          padding: "20px 44px",
          borderRadius: 9999,
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const Overlay: React.FC<OverlayProps> = (props) => {
  // No AbsoluteFill background anywhere above this point — that is what preserves alpha.
  switch (props.kind) {
    case "title-card":
      return <TitleCard {...props} />;
    case "callout":
      return <Callout {...props} />;
    default:
      return <LowerThird {...props} />;
  }
};
