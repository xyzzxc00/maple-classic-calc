"use strict";

// Actual Sep10 pixel crops, transplanted/scaled onto synthetic frames. These are
// algorithm tests, not claims of additional real hardware captures.
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const { fixture, decodeCrop, makeSparseFrame } = require("./fixtures/expocr-hud-20260910");
global.window = global;
require("../js/data.js");
require("../js/expocr.js");
const engine = global.MapleExpOcr;
const test = engine._test;

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function blit(target, source, x, y, scale = 1) {
  const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
  assert.ok(x >= 0 && y >= 0 && x + width <= target.width && y + height <= target.height);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const si = (Math.min(source.height - 1, Math.floor(yy / scale)) * source.width +
        Math.min(source.width - 1, Math.floor(xx / scale))) * 4;
      const ti = ((y + yy) * target.width + x + xx) * 4;
      target.data.set(source.data.subarray(si, si + 4), ti);
    }
  }
}

function modernFrame(width, height, scale = 1, dx = 0, dy = 0) {
  const frame = blank(width, height);
  for (const name of ["lv", "exp"]) {
    const crop = fixture.crops[name];
    const x = Math.round(name === "lv" ? crop.x * scale : width * 0.612);
    const y = height - Math.round((fixture.sourceHeight - crop.y) * scale);
    blit(frame, decodeCrop(name), x + dx, y + dy, scale);
  }
  return frame;
}

// Minimal Canvas2D adapter for the real tick -> crop -> reader -> validation ->
// counters path. It does not replace any OCR/positioning function with a stub.
function canvasFor(initial) {
  let pixels = initial || blank(1, 1);
  const canvas = {
    width: pixels.width, height: pixels.height,
    pixels() {
      if (pixels.width !== canvas.width || pixels.height !== canvas.height) pixels = blank(canvas.width, canvas.height);
      return pixels;
    },
    toDataURL() { return "data:image/png;base64,"; },
    getContext() { return context; },
  };
  const context = {
    imageSmoothingEnabled: false,
    fillStyle: "#fff",
    getImageData(x, y, width, height) { return test.slicePixels(canvas.pixels(), { x, y, width, height }); },
    putImageData(data, x, y) { blit(canvas.pixels(), data, x, y); },
    fillRect(x, y, width, height) {
      const target = canvas.pixels();
      for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) {
        target.data.set([255, 255, 255, 255], (yy * target.width + xx) * 4);
      }
    },
    drawImage(source, ...args) {
      const original = source.pixels ? source.pixels() : source;
      let sx, sy, sw, sh, dx, dy, dw, dh;
      if (args.length === 2) [sx, sy, sw, sh, dx, dy, dw, dh] = [0, 0, original.width, original.height, ...args, original.width, original.height];
      else [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      const target = canvas.pixels();
      for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
        const xx = Math.min(original.width - 1, Math.max(0, sx + Math.floor(x * sw / dw)));
        const yy = Math.min(original.height - 1, Math.max(0, sy + Math.floor(y * sh / dh)));
        const si = (yy * original.width + xx) * 4;
        target.data.set(original.data.subarray(si, si + 4), ((dy + y) * target.width + dx + x) * 4);
      }
    },
  };
  return canvas;
}

function wrongLevelFrame() {
  const frame = modernFrame(1367, 768);
  const badge = blank(60, 30);
  for (let y = 6; y < 26; y++) for (let x = 10; x < 46; x++) {
    badge.data.set([220, 105, 30, 255], (y * badge.width + x) * 4);
  }
  const masks = ["0111110110001111000001111110110001111000110111110", "0111110110001100000110011110011000011000001111111"];
  masks.forEach((mask, i) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (mask[y * 7 + x] === "1") {
      badge.data.set([255, 255, 255, 255], ((13 + y) * badge.width + 17 + i * 10 + x) * 4);
    }
  });
  // Replace the whole original level crop with a synthetic, readable Lv.62.
  blit(frame, blank(110, 40), 0, 728);
  blit(frame, badge, 30, 730);
  assert.equal(test.readLevelFromImage(badge, true), 62);
  return frame;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function promptly(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

function noisyBrackets(width, height) {
  const frame = blank(width, height);
  for (let y = 0; y + 7 < height; y += 12) for (let x = 0; x < width; x += 8) {
    for (let row = 0; row < 7; row++) frame.data.set([153, 204, 51, 255], ((y + row) * width + x) * 4);
  }
  return frame;
}

function checkLocatorBudget() {
  const frame = noisyBrackets(3840, 324);
  // A real readable badge prevents an empty-badge early return from hiding
  // unbounded failed EXP work. All the bracket content is synthetic noise.
  blit(frame, decodeCrop("lv"), 45, frame.height - 27);
  const stats = {};
  const start = performance.now();
  assert.deepEqual(test.locateHudFromImage(frame, 0, stats), []);
  const elapsed = performance.now() - start;
  assert.ok(stats.expReads > 0, "Dense-noise test must exercise EXP decoding");
  assert.ok(stats.pairChecks <= 512 && stats.expReads <= 48 && stats.levelReads <= 16,
    `Unbounded locator work: ${JSON.stringify(stats)}`);
  assert.ok(elapsed < 2500, `Noisy locator blocked for ${elapsed.toFixed(0)}ms`);

  // An actual HUD row near the bottom must take priority over thousands of
  // plausible-looking noise components higher in the search strip.
  const withHud = noisyBrackets(1367, 324);
  blit(withHud, blank(1367, 80), 0, 244);
  for (const name of ["lv", "exp"]) {
    const crop = fixture.crops[name];
    blit(withHud, decodeCrop(name), crop.x, withHud.height - (fixture.sourceHeight - crop.y));
  }
  const prioritized = {};
  assert.ok(test.locateHudFromImage(withHud, 0, prioritized).length, "Noise exhausted the budget before the real HUD");
  assert.ok(prioritized.expReads <= 48 && prioritized.pairChecks <= 512);
  return { ...stats, elapsedMs: Math.round(elapsed) };
}

function isolatedEngine(createWorker, timers = {}) {
  const context = {
    window: { MapleData: global.MapleData, Tesseract: { createWorker } },
    navigator: {},
    document: { createElement(tag) { assert.equal(tag, "canvas"); return canvasFor(); } },
    setTimeout, clearTimeout, clearInterval, ...timers,
  };
  vm.runInNewContext(readFileSync(join(__dirname, "../js/expocr.js"), "utf8"), context);
  return context.window.MapleExpOcr;
}

async function checkCalibrationLifecycle() {
  const valid = () => canvasFor(makeSparseFrame());
  const unknown = () => canvasFor(blank(1367, 768));

  // Worker creation never resolves. Cancellation must finish the old tick and
  // release its frame without launching another worker for subsequent retries.
  const loading = deferred();
  let creations = 0;
  const loadingEngine = isolatedEngine(() => {
    creations++;
    loading.resolve();
    return new Promise(() => {});
  });
  let pending = loadingEngine._tickWith(unknown());
  await promptly(loading.promise, "Worker creation did not start");
  loadingEngine.recalibrate();
  await promptly(loadingEngine._tickWith(valid()), "Recalibration blocked a valid new frame");
  await promptly(pending, "Cancelled worker loading retained its tick");
  assert.equal(loadingEngine.getState().samples, 1);
  loadingEngine._reset();
  pending = loadingEngine._tickWith(unknown());
  loadingEngine.stop();
  await promptly(loadingEngine._tickWith(valid()), "Stop blocked a valid new frame");
  await promptly(pending, "Stop did not cancel worker loading");
  assert.equal(loadingEngine.getState().samples, 1);
  assert.equal(creations, 1, "A pending worker load must be shared across cancellations");
  loadingEngine.stop();

  // Cancel while recognize never resolves. Keep termination pending to put a
  // new tick under the lock before the old tick's finally runs.
  const firstReady = deferred(), secondReady = deferred(), shutdown = deferred();
  let workers = 0, terminations = 0, retired = false;
  const raceEngine = isolatedEngine(async () => {
    const id = ++workers;
    if (id > 1) assert.ok(retired, "Started another worker before previous termination completed");
    return {
      async setParameters() {},
      recognize() {
        (id === 1 ? firstReady : secondReady).resolve();
        return new Promise(() => {});
      },
      terminate() {
        terminations++;
        return id === 1 ? shutdown.promise.then(() => { retired = true; }) : Promise.resolve();
      },
    };
  });
  const oldTick = raceEngine._tickWith(unknown());
  await promptly(firstReady.promise, "Initial recognition did not start");
  raceEngine.recalibrate();
  const newTick = raceEngine._tickWith(unknown());
  await promptly(oldTick, "Cancelled recognition retained its tick");
  await raceEngine._tickWith(valid());
  assert.equal(raceEngine.getState().samples, 0, "Stale finally cleared the new tick's lock");
  assert.equal(workers, 1, "Overlapping worker creation during termination");
  shutdown.resolve();
  await promptly(secondReady.promise, "New calibration did not resume after termination");
  await raceEngine._tickWith(valid());
  assert.equal(raceEngine.getState().samples, 0, "Parallel tick escaped an active calibration lock");
  raceEngine.stop();
  await promptly(raceEngine._tickWith(valid()), "Cancelled recognition blocked new pixel reading");
  await promptly(newTick, "Second cancelled recognition retained its tick");
  assert.equal(raceEngine.getState().samples, 1);
  assert.equal(workers, 2);
  assert.equal(terminations, 2, "Cancelled active workers must each be terminated once");
  raceEngine.stop();

  // Drive the actual calibration deadline deterministically, without sleeping
  // for 15 seconds or replacing any positioning/reading/validation function.
  const timeoutReady = deferred();
  let fireDeadline, cleared = 0, timedOutWorkers = 0;
  const timeoutEngine = isolatedEngine(async () => ({
    async setParameters() {},
    recognize() { timeoutReady.resolve(); return new Promise(() => {}); },
    async terminate() { timedOutWorkers++; },
  }), {
    setTimeout(callback, ms) {
      assert.equal(ms, 15000);
      fireDeadline = callback;
      return 42;
    },
    clearTimeout(id) { assert.equal(id, 42); cleared++; },
  });
  const timeoutTick = timeoutEngine._tickWith(unknown());
  await promptly(timeoutReady.promise, "Timeout recognition did not start");
  fireDeadline();
  await promptly(timeoutTick, "Deadline did not settle calibration");
  await promptly(timeoutEngine._tickWith(valid()), "Timed-out calibration blocked new pixels");
  assert.equal(timeoutEngine.getState().samples, 1);
  assert.equal(timedOutWorkers, 1);
  assert.equal(cleared, 1, "Deadline timer was not released");
  timeoutEngine.stop();
}

async function run() {
  assert.equal(fixture.sourceWidth, 1367, "Do not silently change actual screenshot dimensions to the user's reported width");
  assert.equal(test.readLevelFromImage(decodeCrop("lv"), true), fixture.expected.level);
  assert.deepEqual(test.readExpFromImage(decodeCrop("exp")), { exp: fixture.expected.exp, percent: fixture.expected.percent });
  assert.equal(test.crossCheck(63, 1208864, 85.13), true);
  for (const args of [[63, 1208864, 85.5], [63, 1208864, null], [63, -1, 0], [63, NaN, 0], [63, 1.2, 0], [63, 0, Infinity], [63, 0, -1], [63.1, 1, 0]]) {
    assert.equal(test.crossCheck(...args), false, `Invalid sample admitted: ${args}`);
  }
  const native = makeSparseFrame();
  assert.ok(test.presetReadCandidates(native.width, native.height).every(c => {
    const p = test.readExpFromImage(test.slicePixels(native, c.exp));
    return !test.readLevelCandidatesFromImage(test.slicePixels(native, c.lv), c.wide).some(l => test.crossCheck(l.level, p.exp, p.percent));
  }), "Fixture must reproduce the old positioning failure");
  assert.ok(test.locateHudFromImage(test.slicePixels(native, { x: 0, y: 650, width: native.width, height: 118 }), 650).length);
  assert.deepEqual(test.locateHudFromImage(blank(1366, 120), 648), [], "No HUD must remain unknown");
  assert.deepEqual(test.ocrBoxToRect({ x0: 316, y0: 46, x1: 616, y1: 67 }, { x: 0, y: 700 }, 3, 5, 16),
    { x: 95, y: 707, width: 126, height: 13 }, "OCR padding must be removed before converting coordinates");
  const locatorStats = checkLocatorBudget();

  const originalDocument = global.document, originalTesseract = global.Tesseract;
  let recognize = async () => ({ data: { words: [] } });
  let calibrationCalls = 0;
  let makeWorker = async () => ({
    async setParameters() {}, recognize(...args) { calibrationCalls++; return recognize(...args); },
    async terminate() {},
  });
  global.document = { createElement(tag) { assert.equal(tag, "canvas"); return canvasFor(); } };
  global.Tesseract = { createWorker() { return makeWorker(); } };
  const cases = [
    [1280, 720, 1], [1366, 768, 1], [1367, 768, 1], [1600, 900, 1],
    [1920, 1080, 1], [1920, 1200, 1.25], [2560, 1440, 1], [2560, 1440, 2],
    [3440, 1440, 1.5], [3840, 2160, 1], [3840, 2160, 2], [3840, 2160, 3],
    [4096, 2160, 2], [5120, 1440, 1],
  ];
  try {
    for (const [width, height, scale] of cases) {
      engine._reset();
      const frame = modernFrame(width, height, scale);
      await engine._tickWith(canvasFor(frame));
      const result = engine.getState();
      assert.equal(result.samples, 1, `${width}x${height}@${scale}: ${result.status}`);
      assert.equal(result.level, 63); assert.equal(result.exp, 1208864); assert.equal(result.percent, 85.13);
      assert.equal(result.gainedExp, 0);
      // Second frame must use a verified lock and not fabricate a gain.
      await engine._tickWith(canvasFor(frame));
      assert.match(engine.getState().presetKey, /已定位/);
      assert.equal(engine.getState().gainedExp, 0);
    }
    assert.equal(calibrationCalls, 0, "Known new HUD layouts must not need network OCR");
    engine._reset();
    await engine._tickWith(canvasFor(modernFrame(1920, 1080, 1, 300, -35)));
    assert.equal(engine.getState().samples, 1, engine.getState().status);
    assert.match(engine.getState().presetKey, /特徵定位/, "Offset HUD must be located by its actual pixels");
    assert.equal(calibrationCalls, 0);
    // A resize must invalidate the old lock and read the new dimensions.
    await engine._tickWith(canvasFor(modernFrame(1366, 768)));
    assert.equal(engine.getState().samples, 2);
    assert.match(engine.getState().presetKey, /^1366x768/);

    engine._reset();
    const bad = canvasFor(wrongLevelFrame());
    for (let i = 0; i < 3; i++) await engine._tickWith(bad);
    assert.equal(engine.getState().samples, 0, "Repeated wrong values must not bypass percentage validation");
    assert.equal(engine.getState().gainedExp, 0);
    assert.ok(calibrationCalls >= 1, "Readable but inconsistent crops must trigger recalibration");

    engine._reset();
    let complete;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    recognize = () => new Promise(resolve => { complete = resolve; started(); });
    const pending = engine._tickWith(canvasFor(blank(1366, 768)));
    await ready;
    engine.recalibrate();
    complete({ data: { words: [{ text: "1208864[85.13%]", bbox: { x0: 100, y0: 20, x1: 200, y1: 40 } }] } });
    await pending;
    assert.equal(engine.getState().samples, 0);
    assert.equal(engine.getState().crops, null, "Old async calibration cannot restore cleared crops");
    assert.match(engine.getState().status, /重置|重新/);
    await checkCalibrationLifecycle();
    console.log(`新版 HUD 測試通過：真實 Lv.63／1208864／85.13% 像素、${cases.length} 組合成解析度／縮放、偏移特徵定位、鎖定／縮放重定位、錯值拒收、密集雜訊上限 ${JSON.stringify(locatorStats)}、世代鎖／永不完成的校準取消／worker 清理／逾時。`);
  } finally {
    global.document = originalDocument;
    global.Tesseract = originalTesseract;
    engine._reset();
  }
}

module.exports = { run, canvasFor };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
