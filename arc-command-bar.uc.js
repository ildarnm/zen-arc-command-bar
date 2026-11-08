// ==UserScript==
// @name           Arc Command Bar
// @description    Cmd+T palette with MRU tabs, bookmarks, and search in a new tab.
// @include        main
// ==/UserScript==

(() => {
  "use strict";

  const XHTML = "http://www.w3.org/1999/xhtml";
  const SVG = "http://www.w3.org/2000/svg";
  const PREF_ROOT = "zen-arc-command-bar.";
  const DEFAULT_FAVICON = "chrome://global/skin/icons/defaultFavicon.svg";
  const core = window.ArcCommandBarCore;

  if (!core) {
    console.error("[ArcCommandBar] Core script was not loaded");
    return;
  }

  function pref(name, fallback) {
    const key = PREF_ROOT + name;
    switch (Services.prefs.getPrefType(key)) {
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(key);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(key);
      case Services.prefs.PREF_STRING:
        return Services.prefs.getStringPref(key);
      default:
        return fallback;
    }
  }

  function debug(...args) {
    if (pref("debug", false)) console.debug("[ArcCommandBar]", ...args);
  }

  function element(tag, className) {
    const node = document.createElementNS(XHTML, tag);
    if (className) node.className = className;
    return node;
  }

  function tabUrl(tab) {
    try {
      return tab.linkedBrowser?.currentURI?.spec ?? "";
    } catch {
      return "";
    }
  }

  function isUsableTab(tab) {
    return Boolean(
      tab &&
      tab.isConnected &&
      !tab.closing &&
      !tab.hasAttribute("zen-glance-tab") &&
      !tab.hasAttribute("zen-empty-tab")
    );
  }

  let placesUtils;
  function getPlacesUtils() {
    if (placesUtils) return placesUtils;
    placesUtils = window.PlacesUtils;
    if (!placesUtils) {
      ({ PlacesUtils: placesUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/PlacesUtils.sys.mjs"
      ));
    }
    return placesUtils;
  }

  let mruTabs = [];
  let overlay;
  let panel;
  let input;
  let resultsList;
  let emptyState;
  let selectedIndex = 0;
  let visibleResults = [];
  let renderGeneration = 0;
  let previouslyFocused;
  let startupObserver;

  function allOpenTabs() {
    if (pref("all-workspaces", true)) {
      try {
        const stored = window.gZenWorkspaces?.allStoredTabs;
        if (stored?.length) return [...stored];
      } catch (error) {
        debug("Could not read tabs from all Spaces", error);
      }
    }
    return [...gBrowser.tabs];
  }

  function syncMru() {
    const all = allOpenTabs().filter(isUsableTab);
    const available = new Set(all);
    mruTabs = mruTabs.filter(tab => available.has(tab));
    const known = new Set(mruTabs);
    const missing = all
      .filter(tab => !known.has(tab))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    mruTabs.push(...missing);
  }

  function touchTab(tab) {
    if (!isUsableTab(tab)) return;
    mruTabs = mruTabs.filter(item => item !== tab);
    mruTabs.unshift(tab);
  }

  function openTabCandidates() {
    syncMru();
    const current = gBrowser.selectedTab;
    return mruTabs
      .filter(tab => tab !== current && isUsableTab(tab))
      .map((tab, mruIndex) => ({
        id: `tab:${tab._tPos}:${tab.lastAccessed || 0}`,
        kind: "tab",
        title: tab.label || tabUrl(tab) || "Без названия",
        url: tabUrl(tab),
        icon: tab.image || DEFAULT_FAVICON,
        mruIndex,
        tab,
      }));
  }

  function bookmarkUrl(item) {
    if (!item?.url) return "";
    return item.url.href || item.url.spec || String(item.url);
  }

  async function bookmarkCandidates(query) {
    if (!query.trim()) return [];
    try {
      const currentUrl = core.normalizeUrl(tabUrl(gBrowser.selectedTab));
      const bookmarks = await getPlacesUtils().bookmarks.search({ query: query.trim() });
      return bookmarks
        .filter(item => {
          const url = bookmarkUrl(item);
          return url && core.normalizeUrl(url) !== currentUrl;
        })
        .slice(0, 60)
        .map(item => ({
          id: `bookmark:${item.guid}`,
          kind: "bookmark",
          title: item.title || bookmarkUrl(item),
          url: bookmarkUrl(item),
          icon: `page-icon:${bookmarkUrl(item)}`,
          bookmark: item,
        }));
    } catch (error) {
      debug("Bookmark search failed", error);
      return [];
    }
  }

  function createSearchIcon() {
    const icon = document.createElementNS(SVG, "svg");
    icon.setAttribute("class", "zacb-search-icon");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", "M11.25 6.5a4.75 4.75 0 1 1-9.5 0 4.75 4.75 0 0 1 9.5 0ZM10 10l4.5 4.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("stroke-linecap", "round");
    icon.append(path);
    return icon;
  }

  function createResultRow(result, index) {
    const row = element("button", "zacb-result");
    row.type = "button";
    row.id = `zacb-result-${index}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
    row.dataset.index = String(index);

    const iconBox = element("span", `zacb-result-icon zacb-result-icon-${result.kind}`);
    if (result.kind === "search") {
      iconBox.append(createSearchIcon());
    } else {
      const image = element("img");
      image.alt = "";
      image.src = result.icon || DEFAULT_FAVICON;
      image.addEventListener("error", () => {
        image.src = DEFAULT_FAVICON;
      }, { once: true });
      iconBox.append(image);
    }

    const text = element("span", "zacb-result-text");
    const title = element("span", "zacb-result-title");
    title.textContent = result.title;
    text.append(title);
    if (result.url) {
      const separator = element("span", "zacb-result-separator");
      separator.textContent = "—";
      separator.setAttribute("aria-hidden", "true");
      const url = element("span", "zacb-result-url");
      url.textContent = result.url.replace(/^https?:\/\//i, "");
      text.append(separator, url);
    }
    row.append(iconBox, text);

    row.addEventListener("mousemove", () => selectIndex(index));
    row.addEventListener("mousedown", event => event.preventDefault());
    row.addEventListener("click", () => activateResult(result));
    return row;
  }

  function renderRows(results) {
    visibleResults = results;
    selectedIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));
    resultsList.replaceChildren(...results.map(createResultRow));
    resultsList.hidden = results.length === 0;
    emptyState.hidden = results.length !== 0;
    input.setAttribute(
      "aria-activedescendant",
      results.length ? `zacb-result-${selectedIndex}` : ""
    );
  }

  async function refreshResults({ resetSelection = false } = {}) {
    const generation = ++renderGeneration;
    const query = input.value.trim();
    if (resetSelection) selectedIndex = 0;

    const tabs = openTabCandidates();
    if (!query) {
      renderRows(core.composeResults("", tabs, pref("max-results", 10)));
      return;
    }

    const bookmarks = await bookmarkCandidates(query);
    if (generation !== renderGeneration || !overlay.hasAttribute("open")) return;
    renderRows(core.composeResults(query, [...tabs, ...bookmarks], pref("max-results", 10)));
  }

  function selectIndex(nextIndex) {
    if (!visibleResults.length) return;
    selectedIndex = (nextIndex + visibleResults.length) % visibleResults.length;
    for (const [index, row] of [...resultsList.children].entries()) {
      const selected = index === selectedIndex;
      row.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) row.scrollIntoView({ block: "nearest" });
    }
    input.setAttribute("aria-activedescendant", `zacb-result-${selectedIndex}`);
  }

  function closePalette() {
    if (!overlay?.hasAttribute("open")) return;
    overlay.removeAttribute("open");
    overlay.hidden = true;
    input.value = "";
    visibleResults = [];
    renderGeneration += 1;
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    previouslyFocused = null;
  }

  function openForegroundTab(url, postData) {
    const tab = gBrowser.addTab(url, {
      inBackground: false,
      postData,
      relatedToCurrent: true,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.selectedTab = tab;
  }

  async function openSearch(query) {
    const terms = String(query || "").trim();
    if (!terms) return;

    try {
      const engine = await Services.search.getDefault();
      const submission = engine.getSubmission(terms, null, "keyword");
      if (!submission?.uri?.spec) throw new Error("Search engine returned no URL");

      openForegroundTab(submission.uri.spec, submission.postData);
    } catch (error) {
      console.error("[ArcCommandBar] Default search engine failed; using Google", error);
      openForegroundTab(`https://www.google.com/search?q=${encodeURIComponent(terms)}`);
    }
  }

  function openBookmark(result) {
    openTrustedLinkIn(result.url, "tab", {
      inBackground: false,
      relatedToCurrent: true,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  async function activateResult(result) {
    if (!result) return;
    closePalette();
    if (result.kind === "tab") {
      if (result.tab.group?.isZenFolder && result.tab.group.collapsed) {
        result.tab.group.collapsed = false;
      }
      gBrowser.selectedTab = result.tab;
      return;
    }
    if (result.kind === "bookmark") {
      openBookmark(result);
      return;
    }
    if (result.kind === "url") {
      openForegroundTab(result.url);
      return;
    }
    await openSearch(result.query);
  }

  function openPalette() {
    if (!overlay) buildUi();
    previouslyFocused = document.activeElement;
    selectedIndex = 0;
    input.value = "";
    overlay.hidden = false;
    overlay.setAttribute("open", "true");
    refreshResults({ resetSelection: true });
    requestAnimationFrame(() => input.focus());
  }

  function onInputKeydown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectIndex(selectedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectIndex(selectedIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateResult(visibleResults[selectedIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "Tab") {
      event.preventDefault();
      selectIndex(selectedIndex + (event.shiftKey ? -1 : 1));
    }
  }

  function buildUi() {
    overlay = element("div", "zacb-overlay");
    overlay.id = "zen-arc-command-bar-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "presentation");

    panel = element("section", "zacb-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Поиск вкладок и сохранённых сайтов");

    const inputWrap = element("div", "zacb-input-wrap");
    input = element("input", "zacb-input");
    input.type = "text";
    input.placeholder = "Найти вкладку или сохранённый сайт";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "zacb-results");
    inputWrap.append(createSearchIcon(), input);

    resultsList = element("div", "zacb-results");
    resultsList.id = "zacb-results";
    resultsList.setAttribute("role", "listbox");

    emptyState = element("div", "zacb-empty");
    emptyState.textContent = "Других открытых вкладок нет";
    emptyState.hidden = true;

    panel.append(inputWrap, resultsList, emptyState);
    overlay.append(panel);
    document.documentElement.append(overlay);
    loadPaletteStyle(overlay);

    overlay.addEventListener("mousedown", event => {
      if (event.target === overlay) closePalette();
    });
    input.addEventListener("input", () => refreshResults({ resetSelection: true }));
    input.addEventListener("keydown", onInputKeydown);
  }

  async function loadPaletteStyle(target) {
    try {
      // Read the local file so changes don't depend on Sine's imported CSS cache.
      const path = PathUtils.join(PathUtils.profileDir, "chrome", "sine-mods",
        "zen-arc-command-bar", "arc-command-bar.css");
      const css = await IOUtils.readUTF8(path);
      if (!target.isConnected) return;
      const style = element("style");
      style.textContent = css;
      target.prepend(style);
    } catch (error) {
      console.warn("[ArcCommandBar] Could not refresh palette CSS", error);
    }
  }

  function isCommandT(event) {
    const keyIsT = event.code === "KeyT" || String(event.key).toLocaleLowerCase() === "t";
    const isMac = Services.appinfo.OS === "Darwin";
    const accelerator = isMac ? event.metaKey : event.ctrlKey;
    return keyIsT && accelerator && !event.shiftKey && !event.altKey &&
      (isMac ? !event.ctrlKey : !event.metaKey);
  }

  function onGlobalKeydown(event) {
    if (!isCommandT(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (overlay?.hasAttribute("open")) input.focus();
    else openPalette();
  }

  function onTabSelect(event) {
    touchTab(event.target);
  }

  function onTabClose(event) {
    mruTabs = mruTabs.filter(tab => tab !== event.target);
  }

  function init() {
    syncMru();
    touchTab(gBrowser.selectedTab);
    buildUi();
    window.addEventListener("keydown", onGlobalKeydown, { capture: true });
    gBrowser.tabContainer.addEventListener("TabSelect", onTabSelect);
    gBrowser.tabContainer.addEventListener("TabClose", onTabClose);
    debug("Initialized");
  }

  function destroy() {
    if (startupObserver) {
      Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
      startupObserver = null;
    }
    window.removeEventListener("keydown", onGlobalKeydown, { capture: true });
    gBrowser?.tabContainer?.removeEventListener("TabSelect", onTabSelect);
    gBrowser?.tabContainer?.removeEventListener("TabClose", onTabClose);
    overlay?.remove();
    overlay = panel = input = resultsList = emptyState = null;
    mruTabs = [];
    if (window.__zenArcCommandBar === instance) delete window.__zenArcCommandBar;
  }

  window.__zenArcCommandBar?.destroy?.();
  const instance = { destroy, open: openPalette };
  window.__zenArcCommandBar = instance;
  window.addUnloadListener?.(destroy);
  window.addEventListener("unload", destroy, { once: true });

  if (gBrowserInit.delayedStartupFinished) {
    init();
  } else {
    startupObserver = subject => {
      if (subject !== window) return;
      Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
      startupObserver = null;
      init();
    };
    Services.obs.addObserver(startupObserver, "browser-delayed-startup-finished");
  }
})();
