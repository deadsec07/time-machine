// --- Matching helpers shared by popup.js and page.js ---
function parseTokens(raw) {
  const parts = (raw || "").trim().split(/[\s,]+/).filter(Boolean);
  const tokens = [];
  for (const p of parts) {
    if (p.toLowerCase().startsWith("host:")) {
      tokens.push({ type: "host", value: p.slice(5).toLowerCase() });
    } else {
      tokens.push({ type: "text", value: p.toLowerCase() });
    }
  }
  return tokens;
}
function hostMatches(host, pattern) {
  if (!pattern.includes("*")) return host.includes(pattern);
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + esc + "$", "i").test(host);
}
// AND semantics like chrome://history
function entryMatches(tokens, title, url) {
  const t = (title || "").toLowerCase();
  const u = (url || "").toLowerCase();
  const h = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  const textTokens = tokens.filter(x => x.type === "text");
  const hostTokens = tokens.filter(x => x.type === "host");
  const textOK = textTokens.length === 0 ? true : textTokens.every(tok => t.includes(tok.value) || u.includes(tok.value));
  const hostOK = hostTokens.length === 0 ? true : (h && hostTokens.every(tok => hostMatches(h, tok.value)));
  return textOK && hostOK;
}
function dedupe(arr, key) {
  const seen = new Set();
  return arr.filter(x => {
    const k = x[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function flattenBookmarks(nodes, out = []) {
  for (const n of nodes) {
    if (n.url) out.push({ id: n.id, url: n.url, title: n.title || "" });
    if (n.children) flattenBookmarks(n.children, out);
  }
  return out;
}
