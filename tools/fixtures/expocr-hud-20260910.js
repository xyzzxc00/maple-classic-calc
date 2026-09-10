"use strict";

// Actual, unscaled HUD crops; no image package or full screenshot is required.
// makeSparseFrame() places them on a SYNTHETIC black background at the original
// coordinates. It does not reproduce the rest of the game screenshot.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { inflateSync } = require("node:zlib");
const fixture = require("./expocr-hud-20260910.json");

function decodeCrop(name) {
  const crop = fixture.crops[name];
  assert.ok(crop, `Unknown HUD crop: ${name}`);
  const raw = inflateSync(Buffer.from(crop.rgbaZlibBase64, "base64"));
  assert.equal(raw.length, crop.width * crop.height * 4, `${name}: RGBA byte count`);
  assert.equal(createHash("sha256").update(raw).digest("hex"), crop.rgbaSha256,
    `${name}: original crop pixels changed`);
  return { width: crop.width, height: crop.height, data: new Uint8ClampedArray(raw) };
}

function makeSparseFrame() {
  const width = fixture.sourceWidth;
  const height = fixture.sourceHeight;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [name, rect] of Object.entries(fixture.crops)) {
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width &&
      rect.y + rect.height <= height, `${name}: crop outside source dimensions`);
    const crop = decodeCrop(name);
    for (let y = 0; y < crop.height; y++) {
      const start = y * crop.width * 4;
      data.set(crop.data.subarray(start, start + crop.width * 4),
        ((rect.y + y) * width + rect.x) * 4);
    }
  }
  return { width, height, data };
}

module.exports = { fixture, decodeCrop, makeSparseFrame };
