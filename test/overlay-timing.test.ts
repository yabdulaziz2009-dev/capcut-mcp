import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTiming } from "../src/remotion/bridge.js";

describe("resolveTiming", () => {
  it("uses vertical 1080x1920 at 30fps by default", () => {
    const t = resolveTiming({ text: "x" });
    assert.equal(t.width, 1080);
    assert.equal(t.height, 1920);
    assert.equal(t.fps, 30);
  });

  it("converts seconds to frames", () => {
    assert.equal(resolveTiming({ text: "x", durationSeconds: 2.5 }).durationFrames, 75);
    assert.equal(resolveTiming({ text: "x", durationSeconds: 2, fps: 60 }).durationFrames, 120);
  });

  it("never produces fewer than two frames", () => {
    // A single-frame render is not a video, and Remotion's frame range would be empty.
    assert.equal(resolveTiming({ text: "x", durationSeconds: 0 }).durationFrames, 2);
    assert.equal(resolveTiming({ text: "x", durationSeconds: 0.001 }).durationFrames, 2);
  });

  it("leaves room for the exit animation by default", () => {
    const t = resolveTiming({ text: "x", durationSeconds: 3 });
    assert.equal(t.durationFrames, 90);
    assert.equal(t.exitAtFrame, 75);
  });

  it("keeps the exit inside the clip on short durations", () => {
    const t = resolveTiming({ text: "x", durationSeconds: 0.3 });
    assert.ok(t.exitAtFrame >= 1);
    assert.ok(t.exitAtFrame < t.durationFrames, "exit must land before the last frame");
  });

  it("honours an explicit exit moment", () => {
    assert.equal(resolveTiming({ text: "x", durationSeconds: 4, exitAtSeconds: 2 }).exitAtFrame, 60);
  });

  it("clamps an explicit exit that runs past the end", () => {
    // Otherwise the element would never animate out and the clip ends mid-motion.
    const t = resolveTiming({ text: "x", durationSeconds: 2, exitAtSeconds: 10 });
    assert.equal(t.exitAtFrame, t.durationFrames - 1);
  });
});
