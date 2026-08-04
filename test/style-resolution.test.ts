import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTION_PRESETS, resolveStyle } from "../src/workflows/captions.js";

describe("resolveStyle", () => {
  it("returns the preset untouched when nothing is overridden", () => {
    assert.deepEqual(resolveStyle("bold-outline", undefined), CAPTION_PRESETS["bold-outline"]);
  });

  it("lets an explicit field win over the preset", () => {
    const style = resolveStyle("bold-outline", { color: "#FFEE00" });
    assert.equal(style.color, "#FFEE00");
  });

  it("keeps the rest of the preset when one field is overridden", () => {
    // "bold-outline but yellow" must not silently lose its outline.
    const style = resolveStyle("bold-outline", { color: "#FFEE00" });
    assert.equal(style.border?.width, 18);
    assert.equal(style.border?.color, "#000000");
    assert.equal(style.shadow?.enabled, true);
  });

  it("merges nested groups instead of replacing them", () => {
    const style = resolveStyle("bold-outline", { border: { width: 4 } });
    assert.equal(style.border?.width, 4, "explicit width wins");
    assert.equal(style.border?.color, "#000000", "preset colour survives");
  });

  it("leaves untouched groups absent rather than empty", () => {
    // An empty {} would read as "a background was requested" downstream.
    const style = resolveStyle(undefined, { color: "#FFFFFF" });
    assert.equal(style.background, undefined);
    assert.equal(style.border, undefined);
    assert.equal(style.shadow, undefined);
  });

  it("works with no preset at all", () => {
    const style = resolveStyle(undefined, { fontSize: 12, bold: true });
    assert.deepEqual(style, { fontSize: 12, bold: true });
  });

  it("does not leave undefined keys behind", () => {
    const style = resolveStyle(undefined, { color: "#FFFFFF" });
    assert.deepEqual(Object.keys(style), ["color"]);
  });

  it("rejects an unknown preset and names the valid ones", () => {
    assert.throws(() => resolveStyle("does-not-exist", undefined), (error: Error) => {
      assert.match(error.message, /Unknown preset "does-not-exist"/);
      assert.match(error.message, /bold-outline/);
      return true;
    });
  });

  it("every shipped preset resolves without throwing", () => {
    for (const name of Object.keys(CAPTION_PRESETS)) {
      const style = resolveStyle(name, undefined);
      assert.ok(Object.keys(style).length > 0, `${name} resolved to an empty style`);
    }
  });
});
