// config.ts
var MOCK_MODE = false;
var CACHE_TTL_MS = 5 * 6e4;
var SIGNAL_META = {
  AVOID: { color: "#e5484d", textColor: "#ffffff", label: "AVOID", blurb: "Severe red flags \u2014 likely scam/rug setup." },
  HIGH_RISK: { color: "#f76b15", textColor: "#ffffff", label: "HIGH RISK", blurb: "Multiple serious red flags." },
  WATCH: { color: "#ffb224", textColor: "#1b1b18", label: "RISKY", blurb: "Notable red flags \u2014 read them first." },
  CONSIDER: { color: "#46a758", textColor: "#ffffff", label: "MILD RISK", blurb: "Some red flags found \u2014 not danger-free, not a buy call." },
  NEUTRAL: { color: "#64748b", textColor: "#ffffff", label: "LOW RISK", blurb: "Few red flags found \u2014 still speculative, not safe." }
};
var DISCLAIMER = "Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice.";

// dashboard/dashboard.ts
var JOURNAL_KEY = "ck:journal";
var $ = (id) => document.getElementById(id);
var recent = [];
var journal = [];
document.addEventListener("DOMContentLoaded", () => {
  $("disclaimer").textContent = `\u26A0 ${DISCLAIMER}`;
  $("footer-disclaimer").textContent = DISCLAIMER;
  $("mock-badge").hidden = !MOCK_MODE;
  for (const id of ["f-signal", "f-min-score", "f-max-mcap", "f-max-age"]) {
    $(id).addEventListener("input", renderRecent);
  }
  $("clear-recent").addEventListener("click", () => {
    if (!confirm("Clear the analyzed-tokens history?")) return;
    chrome.runtime.sendMessage({ type: "CLEAR_RECENT" }, () => {
      recent = [];
      renderRecent();
    });
  });
  $("journal-form").addEventListener("submit", onJournalSubmit);
  void loadAll();
});
async function loadAll() {
  chrome.runtime.sendMessage({ type: "GET_RECENT" }, (res) => {
    recent = res?.ok ? res.recent : [];
    renderRecent();
    renderJournal();
  });
  const data = await chrome.storage.local.get(JOURNAL_KEY);
  journal = Array.isArray(data[JOURNAL_KEY]) ? data[JOURNAL_KEY] : [];
  renderJournal();
}
function activeFilters() {
  const signal = $("f-signal").value;
  const minScore = numOrNull($("f-min-score").value);
  const maxMcap = numOrNull($("f-max-mcap").value);
  const maxAge = numOrNull($("f-max-age").value);
  return (row) => {
    if (signal && row.signal !== signal) return false;
    if (minScore !== null && row.riskScore < minScore) return false;
    if (maxMcap !== null && (row.marketCapEur === null || row.marketCapEur > maxMcap)) return false;
    if (maxAge !== null && (row.ageMinutes === null || row.ageMinutes > maxAge)) return false;
    return true;
  };
}
function renderRecent() {
  const body = $("recent-body");
  body.innerHTML = "";
  const rows = recent.filter(activeFilters());
  $("recent-empty").hidden = rows.length > 0;
  for (const row of rows) {
    const tr = document.createElement("tr");
    const token = document.createElement("td");
    const sym = document.createElement("div");
    sym.className = "sym";
    sym.textContent = row.symbol ?? "(unknown)";
    const addr = document.createElement("div");
    addr.className = "addr";
    const link = document.createElement("a");
    link.href = `https://gmgn.ai/sol/token/${row.address}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = short(row.address);
    addr.appendChild(link);
    token.append(sym, addr);
    const score = document.createElement("td");
    score.className = "score";
    score.textContent = row.insufficientData ? "\u2014" : String(row.riskScore);
    const signal = document.createElement("td");
    if (row.insufficientData) {
      signal.textContent = "NO DATA";
    } else {
      const meta = SIGNAL_META[row.signal];
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = meta.label;
      badge.style.background = meta.color;
      badge.style.color = meta.textColor;
      signal.appendChild(badge);
    }
    tr.append(
      token,
      td(age(row.ageMinutes)),
      td(eur(row.marketCapEur)),
      td(eur(row.liquidityEur)),
      score,
      signal,
      td(new Date(row.updatedAt).toLocaleString()),
      td("")
    );
    body.appendChild(tr);
  }
}
function onJournalSubmit(ev) {
  ev.preventDefault();
  const entry = {
    id: crypto.randomUUID(),
    symbol: $("j-symbol").value.trim().toUpperCase(),
    address: $("j-address").value.trim(),
    entryPriceEur: Number($("j-entry").value),
    amountTokens: Number($("j-amount").value),
    exitPriceEur: numOrNull($("j-exit").value),
    note: $("j-note").value.trim(),
    createdAt: Date.now()
  };
  if (!entry.symbol || !(entry.entryPriceEur > 0) || !(entry.amountTokens > 0)) return;
  journal = [entry, ...journal];
  void chrome.storage.local.set({ [JOURNAL_KEY]: journal });
  $("journal-form").reset();
  renderJournal();
}
function renderJournal() {
  const body = $("journal-body");
  body.innerHTML = "";
  $("journal-empty").hidden = journal.length > 0;
  for (const e of journal) {
    const tr = document.createElement("tr");
    const pnlCell = document.createElement("td");
    if (e.exitPriceEur !== null) {
      const pnl = (e.exitPriceEur - e.entryPriceEur) * e.amountTokens;
      pnlCell.className = pnl >= 0 ? "pnl-pos" : "pnl-neg";
      pnlCell.textContent = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`;
    } else {
      const last = e.address ? recent.find((r) => r.address === e.address)?.priceEur : null;
      if (last != null) {
        const pnl = (last - e.entryPriceEur) * e.amountTokens;
        pnlCell.className = pnl >= 0 ? "pnl-pos" : "pnl-neg";
        pnlCell.textContent = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} (unrealized)`;
      } else {
        pnlCell.className = "pnl-open";
        pnlCell.textContent = "open";
      }
    }
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Delete entry";
    del.textContent = "\u2715";
    del.addEventListener("click", () => {
      journal = journal.filter((x) => x.id !== e.id);
      void chrome.storage.local.set({ [JOURNAL_KEY]: journal });
      renderJournal();
    });
    const delCell = document.createElement("td");
    delCell.appendChild(del);
    tr.append(
      td(e.symbol + (e.address ? ` (${short(e.address)})` : "")),
      td(fmtPrice(e.entryPriceEur)),
      td(String(e.amountTokens)),
      td(e.exitPriceEur !== null ? fmtPrice(e.exitPriceEur) : "\u2014"),
      pnlCell,
      td(e.note || "\u2014"),
      td(new Date(e.createdAt).toLocaleDateString()),
      delCell
    );
    body.appendChild(tr);
  }
}
function td(text) {
  const el = document.createElement("td");
  el.textContent = text;
  return el;
}
function numOrNull(v) {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function short(addr) {
  return `${addr.slice(0, 4)}\u2026${addr.slice(-4)}`;
}
function eur(v) {
  if (v === null) return "\u2014";
  if (v >= 1e6) return `\u20AC${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `\u20AC${(v / 1e3).toFixed(0)}k`;
  return `\u20AC${v.toFixed(2)}`;
}
function fmtPrice(v) {
  return `\u20AC${v < 0.01 ? v.toFixed(8) : v.toFixed(4)}`;
}
function age(minutes) {
  if (minutes === null) return "\u2014";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
