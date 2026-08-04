import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hexToRgb01, utf16Bytes } from "../src/capcut/textStyle.js";

/**
 * CapCut addresses style spans by UTF-16LE **byte** offset. Getting this wrong does not
 * throw — it silently mis-styles every non-Latin caption, which is the single most
 * likely way this project breaks for its intended audience (Russian and Uzbek).
 */
describe("utf16Bytes", () => {
  it("counts Latin as one byte per character times two", () => {
    assert.equal(utf16Bytes("hello"), 10);
  });

  it("counts Cyrillic as two bytes per character", () => {
    // 6 characters, still in the BMP, so 2 bytes each.
    assert.equal(utf16Bytes("Привет"), 12);
  });

  it("counts Uzbek Latin with modifier letters correctly", () => {
    // ʻ (U+02BB) is a separate BMP code point, not a combining mark on the o.
    const text = "oʻquvchi";
    assert.equal(utf16Bytes(text), text.length * 2);
  });

  it("counts an emoji as four bytes (surrogate pair)", () => {
    assert.equal(utf16Bytes("🎬"), 4);
  });

  it("matches the range observed in a real CapCut project", () => {
    // Verified against draft_content.json written by CapCut 9.1.
    assert.equal(utf16Bytes("Тест capcut-mcp · 9.1"), 42);
    assert.equal(utf16Bytes("Третий — с эмодзи 🎬"), 40);
  });

  it("agrees with String.length for BMP text but not for emoji", () => {
    assert.equal(utf16Bytes("abc"), "abc".length * 2);
    // A surrogate pair is 2 code units => 4 bytes, so length*2 still holds.
    assert.equal(utf16Bytes("a🎬"), "a🎬".length * 2);
  });
});

describe("hexToRgb01", () => {
  it("converts white", () => {
    assert.deepEqual(hexToRgb01("#FFFFFF"), [1, 1, 1]);
  });

  it("converts black", () => {
    assert.deepEqual(hexToRgb01("#000000"), [0, 0, 0]);
  });

  it("converts the brand accent, matching what CapCut stored", () => {
    const [r, g, b] = hexToRgb01("#FFEE00");
    assert.equal(r, 1);
    assert.ok(Math.abs(g - 0.9333333333333333) < 1e-12);
    assert.equal(b, 0);
  });

  it("accepts a value without the leading hash", () => {
    assert.deepEqual(hexToRgb01("FFFFFF"), [1, 1, 1]);
  });

  it("rejects malformed colours instead of writing garbage into the draft", () => {
    assert.throws(() => hexToRgb01("#FFF"), /Expected #RRGGBB/);
    assert.throws(() => hexToRgb01("red"), /Expected #RRGGBB/);
    assert.throws(() => hexToRgb01("#GGGGGG"), /Expected #RRGGBB/);
  });
});
