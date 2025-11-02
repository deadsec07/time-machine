// popup.js — Popup controller (opens full page + wraps long URLs)

// DOM refs
const $ = sel => document.querySelector(sel);
const hList = $("#hList");
const bList = $("#bList");
const hCount = $("#hCount");
const bCount = $("#bCount");
const statusEl = $("#status");
const deleteBtn = $("#deleteBtn");
const resultsEl = $("#results");
const hSelectAll = $("#hSelectAll");
const bSelectAll = $("#bSelectAll");

// State
let state = {
  history: [],
  bookmarks: [],
  selectedHistory: new Set(),
  selectedBookmarks: new Set()
};

function setStatus(msg) { statusEl.textContent = msg || ""; }
function refreshDeleteEnabled() {
  deleteBtn.disabled = (state.selectedHistory.size + state.selectedBookmarks.size) === 0;
}

// Rendering
function renderList(listEl, items, type) {
  listEl.innerHTML = "";
  for (const it of items) {
    const li = document.createElement("li");
    li.className = "item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.type = type;
    cb.dataset.key = type === "history" ? it.url : it.id;
    cb.checked = (type === "history" ? state.selectedHistory.has(it.url) : state.selectedBookmarks.has(it.id));
    cb.addEventListener("change", () => {
      if (type === "history") {
        cb.checked ? state.selectedHistory.add(it.url) : state.selectedHistory.delete(it.url);
      } else {
        cb.checked ? state.selectedBookmarks.add(it.id) : state.selectedBookmarks.delete(it.id);
      }
      refreshDeleteEnabled();
    });

    const meta = document.createElement("div");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = it.title || (type === "history" ? "(no title)" : "(bookmark)");

    const url = document.createElement("div");
    url.className = "url";
    const a = document.createElement("a");
    a.href = it.url;
    a.target = "_blank";
    a.textContent = it.url;
    url.appendChild(a);

    meta.appendChild(title);
    meta.appendChild(url);

    li.appendChild(cb);
    li.appendChild(meta);
    listEl.appendChild(li);
  }
}

// Search (Chrome-like)
async function searchHistory(tokens) {
  const textQ = tokens.filter(t => t.type === "text").map(t => t.value).join(" ");
  const query = textQ || "";
  const cap = 20000;

  const res = await chrome.history.search({
    text: query,
    startTime: 0,
    maxResults: cap
  });

  const items = dedupe(res.map(r => ({ url: r.url, title: r.title || "" })), "url");
  return items.filter(r => entryMatches(tokens, r.title, r.url));
}
async function searchBookmarks(tokens) {
  const textQ = tokens.filter(t => t.type === "text").map(t => t.value).join(" ");
  let rawResults;
  if (textQ) {
    rawResults = await chrome.bookmarks.search(textQ);
    rawResults = (rawResults || []).map(n => n.url ? { id: n.id, url: n.url, title: n.title || "" } : null).filter(Boolean);
  } else {
    const tree = await chrome.bookmarks.getTree();
    rawResults = flattenBookmarks(tree, []);
  }
  const uniq = dedupe(rawResults, "id");
  return uniq.filter(r => entryMatches(tokens, r.title, r.url));
}

// Actions
async function onPreview() {
  const q = $("#q").value;
  const incHistory = $("#incHistory").checked;
  const incBookmarks = $("#incBookmarks").checked;

  const tokens = parseTokens(q);
  setStatus("Searching…");
  state.selectedHistory.clear();
  state.selectedBookmarks.clear();
  refreshDeleteEnabled();

  let [h, b] = [[], []];
  try {
    await Promise.all([
      (async () => { h = incHistory ? await searchHistory(tokens) : []; })(),
      (async () => { b = incBookmarks ? await searchBookmarks(tokens) : []; })()
    ]);
  } catch (e) {
    console.error(e);
    setStatus("Error while searching.");
    return;
  }

  state.history = h;
  state.bookmarks = b;

  hCount.textContent = `(${h.length})`;
  bCount.textContent = `(${b.length})`;
  renderList(hList, h, "history");
  renderList(bList, b, "bookmarks");

  hSelectAll.checked = false;
  bSelectAll.checked = false;

  resultsEl.classList.remove("hidden");
  setStatus(h.length === 0 && b.length === 0 ? "No matches." : "Preview ready. Select items to delete.");
}

async function onDelete() {
  const hSel = Array.from(state.selectedHistory);
  const bSel = Array.from(state.selectedBookmarks);
  if (hSel.length + bSel.length === 0) return;

  const ok = confirm(
    `Delete ${hSel.length} history entr${hSel.length === 1 ? "y" : "ies"} and ` +
    `${bSel.length} bookmark${bSel.length === 1 ? "" : "s"}?\n\n` +
    `⚠️ This is permanent. If Chrome Sync is enabled, deletions will sync across your devices.`
  );
  if (!ok) return;

  setStatus("Deleting…");
  deleteBtn.disabled = true;

  try {
    await Promise.all(hSel.map(url => chrome.history.deleteUrl({ url })));
    await Promise.all(bSel.map(async (id) => {
      try { await chrome.bookmarks.removeTree(id); }
      catch { await chrome.bookmarks.remove(id); }
    }));

    if (hSel.length) {
      state.history = state.history.filter(x => !state.selectedHistory.has(x.url));
      state.selectedHistory.clear();
    }
    if (bSel.length) {
      state.bookmarks = state.bookmarks.filter(x => !state.selectedBookmarks.has(x.id));
      state.selectedBookmarks.clear();
    }

    hCount.textContent = `(${state.history.length})`;
    bCount.textContent = `(${state.bookmarks.length})`;
    renderList(hList, state.history, "history");
    renderList(bList, state.bookmarks, "bookmarks");

    setStatus("Done. Items deleted.");
  } catch (e) {
    console.error(e);
    setStatus("Error while deleting. Some items may remain.");
  } finally {
    refreshDeleteEnabled();
  }
}

// Wire-up
function wire() {
  $("#previewBtn").addEventListener("click", onPreview);
  $("#deleteBtn").addEventListener("click", onDelete);

  hSelectAll.addEventListener("change", () => {
    state.selectedHistory.clear();
    if (hSelectAll.checked) state.history.forEach(x => state.selectedHistory.add(x.url));
    renderList(hList, state.history, "history");
    refreshDeleteEnabled();
  });
  bSelectAll.addEventListener("change", () => {
    state.selectedBookmarks.clear();
    if (bSelectAll.checked) state.bookmarks.forEach(x => state.selectedBookmarks.add(x.id));
    renderList(bList, state.bookmarks, "bookmarks");
    refreshDeleteEnabled();
  });

  chrome.storage.local.get(["lastQ"]).then(({ lastQ }) => {
    if (lastQ) $("#q").value = lastQ;
  });
  $("#q").addEventListener("change", e => chrome.storage.local.set({ lastQ: e.target.value }));

  // Open full page without needing "tabs" permission
  $("#openFull").addEventListener("click", () => {
    const url = chrome.runtime.getURL("page.html");
    window.open(url, "_blank");
  });
}
document.addEventListener("DOMContentLoaded", wire);
