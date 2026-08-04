import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importSubtitles } from "../src/workflows/subtitles.js";

/**
 * Input validation runs before the project is touched, so these assertions never
 * write anything — a bad call must fail loudly and cheaply rather than halfway
 * through someone's timeline.
 */
const project = "C:/nonexistent/project";

describe("importSubtitles input validation", () => {
  it("requires a source", () => {
    assert.throws(
      () => importSubtitles({ project }),
      /Supply either `path`.*or `content`/,
    );
  });

  it("rejects both sources at once", () => {
    assert.throws(
      () => importSubtitles({ project, path: "a.srt", content: "1\n..." }),
      /not both/,
    );
  });

  it("reports a missing file by name", () => {
    assert.throws(
      () => importSubtitles({ project, path: "C:/nope/missing.srt" }),
      /SRT file not found: C:\/nope\/missing\.srt/,
    );
  });

  it("rejects an unknown preset and lists the valid ones", () => {
    assert.throws(
      () => importSubtitles({ project, content: "x", preset: "neon" }),
      (error: Error) => {
        assert.match(error.message, /Unknown preset "neon"/);
        assert.match(error.message, /bold-outline/);
        return true;
      },
    );
  });

  it("validates before reaching the project, so a bad project path is not what fails", () => {
    // If validation ran after the compatibility check, this would complain about the
    // project instead of the missing source — and the error would mislead the caller.
    assert.throws(() => importSubtitles({ project }), /Supply either/);
  });
});
