// ==UserScript==
// @name           Arc Command Bar Core
// @description    Pure ranking and result composition for Arc Command Bar.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .trim();
  }

  function normalizeUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      url.hash = "";
      if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
      return url.href;
    } catch {
      return raw.replace(/#.*$/, "").replace(/\/+$/, "");
    }
  }

  function fuzzySubsequenceScore(needle, haystack) {
    let at = 0;
    let first = -1;
    let last = -1;
    let consecutive = 0;
    let bestRun = 0;

    for (let i = 0; i < haystack.length && at < needle.length; i += 1) {
      if (haystack[i] !== needle[at]) continue;
      if (first < 0) first = i;
      consecutive = last === i - 1 ? consecutive + 1 : 1;
      bestRun = Math.max(bestRun, consecutive);
      last = i;
      at += 1;
    }

    if (at !== needle.length) return -1;
    const span = last - first + 1;
    return 180 + bestRun * 18 - (span - needle.length) * 3 - first;
  }

  function scoreCandidate(query, candidate) {
    const q = normalizeText(query);
    if (!q) return candidate.kind === "tab" ? 1000 - (candidate.mruIndex ?? 999) : 0;

    const title = normalizeText(candidate.title);
    const url = normalizeText(candidate.url);
    const haystack = `${title} ${url}`.trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every(token => haystack.includes(token))) {
      const fuzzy = fuzzySubsequenceScore(q.replace(/\s+/g, ""), haystack.replace(/\s+/g, ""));
      return fuzzy;
    }

    let score = 300;
    if (title === q) score += 1000;
    else if (title.startsWith(q)) score += 820;
    else if (title.split(/\W+/).some(word => word.startsWith(q))) score += 680;
    else if (title.includes(q)) score += 560;
    else if (url.includes(q)) score += 420;

    score += tokens.reduce((sum, token) => {
      if (title.startsWith(token)) return sum + 90;
      if (title.includes(token)) return sum + 60;
      if (url.includes(token)) return sum + 30;
      return sum;
    }, 0);

    if (candidate.kind === "tab") {
      score += 55;
      score += Math.max(0, 35 - (candidate.mruIndex ?? 35));
    }

    return score;
  }

  function rankCandidates(query, candidates) {
    const byUrl = new Map();

    for (const candidate of candidates) {
      const score = scoreCandidate(query, candidate);
      if (score < 0) continue;
      const key = normalizeUrl(candidate.url) || `${candidate.kind}:${normalizeText(candidate.title)}`;
      const previous = byUrl.get(key);
      if (!previous || candidate.kind === "tab" || score > previous.score) {
        byUrl.set(key, { ...candidate, score });
      }
    }

    return [...byUrl.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.kind !== b.kind) return a.kind === "tab" ? -1 : 1;
      return (a.mruIndex ?? Number.MAX_SAFE_INTEGER) - (b.mruIndex ?? Number.MAX_SAFE_INTEGER);
    });
  }

  function directWebUrl(query) {
    if (/[\s\\]/.test(query)) return null;

    const hasWebScheme = /^https?:\/\//i.test(query);
    const isBareDomain = /^[^/?#:@]+\.(?:[\p{L}]{2,}|xn--[a-z0-9-]+)(?::\d+)?(?:[/?#]|$)/iu.test(query);
    if (!hasWebScheme && !isBareDomain) return null;

    try {
      const url = new URL(hasWebScheme ? query : `https://${query}`);
      if (!url.username && !url.password) return url.href;
    } catch {
      // Invalid addresses are still available as ordinary search queries.
    }
    return null;
  }

  function composeResults(query, candidates, maxResults = 10) {
    const q = String(query ?? "").trim();
    const limit = Math.max(2, Number(maxResults) || 10);
    const ranked = rankCandidates(q, candidates);

    if (!q) return ranked.slice(0, limit);

    const search = {
      id: `search:${q}`,
      kind: "search",
      title: `Искать «${q}»`,
      url: "",
      query: q,
      score: 0,
    };

    const actions = [search];
    const url = directWebUrl(q);
    if (url) {
      actions.push({ id: `url:${url}`, kind: "url", title: "Открыть сайт", url });
    }

    if (!ranked.length) return actions;
    return [ranked[0], ...actions, ...ranked.slice(1)].slice(0, limit);
  }

  const api = Object.freeze({
    normalizeText,
    normalizeUrl,
    scoreCandidate,
    rankCandidates,
    composeResults,
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.ArcCommandBarCore = api;
})();
