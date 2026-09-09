"use strict";

// Run: node tools/test_db_async.js
// Execute the real database functions with deferred requests and a small DOM
// stub. No browser, network, generated data, or timing-dependent sleeps needed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../js/db.js"), "utf8");

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing db.js section: ${start}`);
  return source.slice(from, to);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element() {
  const handlers = new Map();
  return {
    hidden: false, innerHTML: "", textContent: "", value: "",
    addEventListener(type, callback) { handlers.set(type, callback); },
    dispatch(type) { handlers.get(type)?.({ target: this }); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function evidenceHarness() {
  const context = vm.createContext({});
  vm.runInContext(section("function esc(s) {", "  // 12345")
    + section("function relationNotes(row) {", "  const scope ="), context);
  return context;
}

test("relationship notes identify mixed old-version evidence without relabeling unrelated rows", () => {
  const h = evidenceHarness();
  assert.match(h.relationNotes({ sourceEvidence: [{ source: "client" }, { source: "tmsv113" }] }), /TMS v113.*本服待確認/);
  assert.equal(h.relationNotes({ id: 1, source: "client" }), "");
  assert.equal(h.annotatedChip("<a>monster</a>", { id: 1 }), "<a>monster</a>");
});

test("quest-only drops retain their conditions in the relationship display", () => {
  const h = evidenceHarness();
  const note = h.relationNotes({ source: "quest", questIds: [123], questNames: ["測試任務"] });
  assert.match(note, /任務限定掉落/);
  assert.match(note, /測試任務（123）/);
  assert.match(note, /需符合任務條件，非一般掉落/);
});

test("source notes cannot inject HTML into relation chips", () => {
  const h = evidenceHarness();
  const html = h.annotatedChip("<a>monster</a>", { sourceNote: '<img src=x onerror="alert(1)">' });
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
});

test("supplemental quest conditions are shown without confusing mixed conditions with quest-only drops", () => {
  const h = evidenceHarness();
  assert.match(h.relationNotes({ source: "tmsv113", dropConditions: [{ questId: 123 }] }), /任務限定掉落.*任務：123/);
  for (const alternative of [{ questId: 0 }, {}]) {
    const note = h.relationNotes({ source: "tmsv113", dropConditions: [{ questId: 123 }, alternative] });
    assert.match(note, /來源條件不一/);
    assert.ok(!note.includes("非一般掉落"));
  }
});

function detailHarness() {
  const nodes = Object.fromEntries(["ListPanel", "Detail", "List", "Count"]
    .map((suffix) => [`dbTest${suffix}`, element()]));
  const requests = [], effects = [], errors = [];
  const state = { route: null };
  const context = vm.createContext({
    document: { getElementById: (id) => nodes[id] || null },
    page: element(), PREVIEW: false, DB_ROOT: "data/preview/el-nath",
    LOAD_ERROR: "index failed", currentRoute: () => state.route,
    previewNotice: () => "", setTimeout, clearTimeout,
    console: { error: (...args) => errors.push(args) },
    getJson(url) {
      const request = { url, ...deferred() };
      requests.push(request);
      return request.promise;
    },
    config: {
      prefix: "dbTest", dir: "maps", route: "map", key: "maps",
      label: "地圖", unit: "張", filters: [],
      renderRow: (row) => `row:${row.id}`,
      renderDetail: (row) => `detail:${row.id}`,
      afterDetail: (row) => effects.push(row.id),
    },
  });
  vm.runInContext(section("function makeSet(cfg) {", "  // ------------------------------------------------------------- 網址路由")
    + "\nthis.set = makeSet(config);", context);
  return { set: context.set, requests, effects, errors, state,
    detail: nodes.dbTestDetail, list: nodes.dbTestListPanel };
}

test("a late detail success cannot replace the newest detail or run its effects", async () => {
  const h = detailHarness();
  const a = h.set.showDetail("A"), b = h.set.showDetail("B");
  h.requests[1].resolve({ id: "B" });
  assert.equal(await b, true);
  h.requests[0].resolve({ id: "A" });
  assert.equal(await a, false);
  assert.equal(h.detail.innerHTML, "detail:B");
  assert.deepEqual(h.effects, ["B"]);
});

test("a late detail error cannot replace the newest detail", async () => {
  const h = detailHarness();
  const a = h.set.showDetail("A"), b = h.set.showDetail("B");
  h.requests[1].resolve({ id: "B" });
  await b;
  h.requests[0].reject(new Error("old failure"));
  assert.equal(await a, false);
  assert.equal(h.detail.innerHTML, "detail:B");
  assert.equal(h.errors.length, 0);
});

for (const outcome of ["success", "error"]) {
  test(`returning to the list invalidates pending detail ${outcome}`, async () => {
    const h = detailHarness();
    const request = h.set.showDetail("A");
    h.set.showList();
    if (outcome === "success") h.requests[0].resolve({ id: "A" });
    else h.requests[0].reject(new Error("late failure"));
    assert.equal(await request, false);
    assert.equal(h.detail.hidden, true);
    assert.equal(h.detail.innerHTML, "");
    assert.equal(h.list.hidden, false);
    assert.deepEqual(h.effects, []);
    assert.equal(h.errors.length, 0);
  });
}

test("opening a cached detail also invalidates the pending detail", async () => {
  const h = detailHarness();
  const firstB = h.set.showDetail("B");
  h.requests[0].resolve({ id: "B" });
  await firstB;
  const a = h.set.showDetail("A");
  assert.equal(await h.set.showDetail("B"), true);
  assert.equal(h.requests.length, 2, "cached B must not refetch");
  h.requests[1].resolve({ id: "A" });
  await a;
  assert.equal(h.detail.innerHTML, "detail:B");
  assert.deepEqual(h.effects, ["B", "B"]);
});

test("the current detail error still renders a useful error and logs its cause", async () => {
  const h = detailHarness();
  const request = h.set.showDetail("A");
  h.requests[0].reject(new Error("current failure"));
  assert.equal(await request, true);
  assert.match(h.detail.innerHTML, /這筆地圖資料載入失敗/);
  assert.equal(h.errors.length, 1);
});

test("returning before initial index and detail loads finish stays on the list", async () => {
  const h = detailHarness();
  h.state.route = { set: "map", id: "A" };
  const index = h.set.load(), detail = h.set.showDetail("A");
  h.state.route = null;
  h.set.showList();
  h.requests[0].resolve([{ id: "A", name: "A" }]);
  h.requests[1].resolve({ id: "A" });
  await Promise.all([index, detail]);
  assert.equal(h.requests.length, 2, "index load must not reopen the detail");
  assert.equal(h.detail.hidden, true);
  assert.equal(h.detail.innerHTML, "");
  assert.equal(h.list.hidden, false);
});

test("outdated navigation does not scroll the page after completion", async () => {
  const pending = [], scrolls = [];
  let route = null;
  const context = vm.createContext({
    SETS: [{ route: "map", key: "maps", load() {}, showDetail() {
      const request = deferred(); pending.push(request); return request.promise;
    } }],
    window: { scrollTo: (...args) => scrolls.push(args) },
    showTab() {}, currentRoute: () => route,
  });
  vm.runInContext(section("function openDetail(set, id, push) {", "  // 職業技能總覽用的狀態"), context);
  route = { set: "map", id: "A" };
  context.openDetail("map", "A", false);
  pending[0].resolve(false);
  await flush();
  assert.equal(scrolls.length, 0);
  context.openDetail("map", "A", false);
  route = { set: "monster", id: "B" };
  pending[1].resolve(true);
  await flush();
  assert.equal(scrolls.length, 0);
  route = { set: "map", id: "A" };
  context.openDetail("map", "A", false);
  pending[2].resolve(true);
  await flush();
  assert.equal(scrolls.length, 1);
});

function searchHarness(min = 1) {
  const input = element(), results = element(), requests = [], timers = new Map();
  let timerId = 0, loaded = false;
  const set = {
    route: "map", label: "地圖", unit: "張", hasIndex: () => loaded,
    ensure() {
      const request = deferred(); requests.push(request); return request.promise;
    },
    search: (q) => [{ id: q, name: `result:${q}` }],
  };
  const context = vm.createContext({
    document: { getElementById: (id) => id === "dbGlobalSearch" ? input : results },
    SETS: [set], esc: String, previewBadge: () => "",
    dbHref: (kind, id) => `?preview=el-nath&db=${kind}&id=${id}`,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  // SEARCH_MIN is currently one Chinese character. Raising it in this isolated
  // instance also exercises non-empty queries below a future minimum length.
  const searchSource = section("  const searchEls = {", '  window.addEventListener("popstate"');
  assert.ok(searchSource.includes("const SEARCH_MIN = 1;"));
  vm.runInContext(searchSource.replace("const SEARCH_MIN = 1;", `const SEARCH_MIN = ${min};`), context);
  return {
    input, results, requests, timers,
    run(value) { input.value = value; context.runGlobalSearch(); },
    type(value) { input.value = value; input.dispatch("input"); },
    tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    complete(index, success = true) { loaded = success; requests[index].resolve(); },
  };
}

test("out-of-order search completion keeps only the latest query", async () => {
  const h = searchHarness();
  h.run("old"); h.run("new");
  h.complete(1); await flush();
  const latest = h.results.innerHTML;
  assert.match(latest, /result:new/);
  h.complete(0); await flush();
  assert.equal(h.results.innerHTML, latest);
});

for (const value of ["", "   "]) {
  test(`clearing a pending search to ${JSON.stringify(value)} stays empty`, async () => {
    const h = searchHarness();
    h.run("old"); h.type(value);
    assert.equal(h.results.innerHTML, "", "clear must be immediate, before debounce");
    assert.equal(h.timers.size, 0);
    h.complete(0); await flush();
    assert.equal(h.results.innerHTML, "");
  });
}

test("a short query invalidates pending work even when search is called directly", async () => {
  const h = searchHarness(2);
  h.run("old"); h.run("x");
  h.complete(0); await flush();
  assert.equal(h.results.innerHTML, "");
});

test("new input invalidates the previous search during the debounce interval", async () => {
  const h = searchHarness();
  h.run("old"); h.type("new");
  h.complete(0); await flush();
  assert.doesNotMatch(h.results.innerHTML, /result:old/);
  h.tick(); h.complete(1); await flush();
  assert.match(h.results.innerHTML, /result:new/);
});

test("clearing also cancels a queued debounce without starting another request", () => {
  const h = searchHarness();
  h.type("queued"); h.type(""); h.tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.results.innerHTML, "");
});

test("a stale failed-index search cannot replace newer results", async () => {
  const h = searchHarness();
  h.run("old"); h.run("new");
  h.complete(1); await flush();
  const latest = h.results.innerHTML;
  h.complete(0, false); await flush();
  assert.equal(h.results.innerHTML, latest);
});

test("a failed-index response after clearing does not restore an error message", async () => {
  const h = searchHarness();
  h.run("old"); h.type("");
  h.complete(0, false); await flush();
  assert.equal(h.results.innerHTML, "");
});

test("the current failed-index search still reports incomplete results", async () => {
  const h = searchHarness();
  h.run("current"); h.complete(0, false); await flush();
  assert.match(h.results.innerHTML, /資料載入失敗/);
});
