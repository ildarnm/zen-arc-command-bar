"use strict";

const assert = require("node:assert/strict");
const core = require("../arc-command-bar-core.uc.js");

function tab(title, url, mruIndex) {
  return { id: `tab:${mruIndex}`, kind: "tab", title, url, mruIndex };
}

function bookmark(title, url) {
  return { id: `bookmark:${url}`, kind: "bookmark", title, url };
}

{
  const results = core.composeResults("", [
    tab("Previous", "https://previous.example", 0),
    tab("Older", "https://older.example", 1),
  ]);
  assert.equal(results[0].title, "Previous", "empty query keeps MRU order");
  assert.ok(results.every(result => result.kind === "tab"), "empty query only contains tabs");
}

{
  const results = core.composeResults("github", [
    tab("GitHub", "https://github.com", 3),
    bookmark("GitHub Docs", "https://docs.github.com"),
  ]);
  assert.equal(results[0].kind, "tab", "best matching open tab is first");
  assert.equal(results[1].kind, "search", "search action is second when matches exist");
  assert.equal(results[2].kind, "bookmark", "remaining matches follow search");
}

{
  const results = core.composeResults("no-match", [tab("GitHub", "https://github.com", 0)]);
  assert.deepEqual(results.map(result => result.kind), ["search"], "search is first without matches");
}

{
  const results = core.composeResults("example", [
    bookmark("Saved Example", "https://example.com/"),
    tab("Open Example", "https://example.com", 4),
  ]);
  assert.equal(results.filter(result => result.kind !== "search").length, 1, "same URL is deduplicated");
  assert.equal(results[0].kind, "tab", "open tab wins over saved duplicate");
}

{
  const results = core.composeResults("docs api", [
    bookmark("API documentation", "https://example.com/docs"),
    bookmark("Documentation", "https://example.com/blog"),
  ]);
  assert.equal(results[0].url, "https://example.com/docs", "all query tokens must match");
}

{
  const url = "https://example.com/docs?q=zen#start";
  const results = core.composeResults(url, []);
  assert.deepEqual(results.map(result => result.kind), ["search", "url"]);
  assert.equal(results[1].url, url, "opening a URL preserves its query and fragment");
}

{
  const results = core.composeResults("example.com/docs", [
    tab("Docs", "https://example.com/docs", 0),
  ]);
  assert.deepEqual(results.map(result => result.kind), ["tab", "search", "url"]);
  assert.equal(results[2].url, "https://example.com/docs");
}

{
  for (const query of ["docs for example.com", "javascript:alert(1)", "file:///tmp/example", "https://"]) {
    assert.deepEqual(core.composeResults(query, []).map(result => result.kind), ["search"]);
  }
}

console.log("Arc Command Bar core tests passed");
