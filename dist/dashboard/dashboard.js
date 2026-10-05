// config.ts
var MOCK_MODE = false;
var CACHE_TTL_MS = 5 * 6e4;
var GRADE_META = [
  {
    min: 80,
    label: "GEM GRADE",
    color: "#d4a017",
    textColor: "#1b1b18",
    blurb: 'Passed every check we can run \u2014 still speculative, never "safe".'
  },
  {
    min: 60,
    label: "STRONG",
    color: "#46a758",
    textColor: "#ffffff",
    blurb: "Most checks passed \u2014 read the remaining flags before anything."
  },
  {
    min: 40,
    label: "MIXED",
    color: "#ffb224",
    textColor: "#1b1b18",
    blurb: "Real flags or unverified checks \u2014 not an opportunity signal."
  },
  {
    min: 20,
    label: "WEAK",
    color: "#f76b15",
    textColor: "#ffffff",
    blurb: "Serious problems found \u2014 the odds are against you here."
  },
  {
    min: 0,
    label: "AVOID",
    color: "#e5484d",
    textColor: "#ffffff",
    blurb: "Severe red flags \u2014 this looks like a scam/rug setup."
  }
];
var DISCLAIMER = "Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice.";

// lib/kingGrade.ts
function gradeLabel(grade) {
  if (grade === null) return "NO DATA";
  for (const bucket of GRADE_META) if (grade >= bucket.min) return bucket.label;
  return "AVOID";
}
function gradeColors(grade) {
  if (grade === null) return { color: "#3a3f4c", textColor: "#e6e8ee" };
  for (const bucket of GRADE_META) if (grade >= bucket.min) return { color: bucket.color, textColor: bucket.textColor };
  return { color: "#e5484d", textColor: "#ffffff" };
}

// lib/longHold.ts
var LONG_HOLD_TIER_META = {
  CANDIDATE: { label: "\u{1F3D4} LONG-HOLD CANDIDATE", color: "#d4a017", textColor: "#1b1b18" },
  WATCH: { label: "\u{1F440} WATCH", color: "#46a758", textColor: "#ffffff" },
  WEAK: { label: "WEAK", color: "#f76b15", textColor: "#ffffff" },
  TOO_EARLY: { label: "\u23F3 TOO EARLY", color: "#3a3f4c", textColor: "#e6e8ee" },
  LATE: { label: "\u{1F4C8} ALREADY BIG", color: "#5b4bb7", textColor: "#ffffff" },
  NOT_A_HOLD: { label: "\u26D4 NOT A HOLD", color: "#e5484d", textColor: "#ffffff" },
  NO_DATA: { label: "NO DATA", color: "#3a3f4c", textColor: "#e6e8ee" }
};

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
  loadAccuracy();
  loadLongHoldAccuracy();
});
function loadLongHoldAccuracy() {
  chrome.runtime.sendMessage({ type: "GET_LH_ACCURACY" }, (res) => {
    const body = $("lh-body");
    const note = $("lh-note");
    if (!res || !res.ok) {
      note.textContent = "Long-hold report card unavailable.";
      return;
    }
    body.innerHTML = "";
    for (const r of res.rows) {
      const tr = document.createElement("tr");
      const rate = document.createElement("td");
      const pct = r.checked ? Math.round(r.survived / r.checked * 100) : null;
      rate.className = pct === null ? "" : pct >= 50 ? "pnl-pos" : "pnl-neg";
      rate.textContent = pct === null ? "\u2014" : `${pct}%`;
      const mult = document.createElement("td");
      mult.textContent = r.medianMultiple === null ? "\u2014" : `${r.medianMultiple.toFixed(2)}\xD7`;
      if (r.medianMultiple !== null) mult.className = r.medianMultiple >= 1 ? "pnl-pos" : "pnl-neg";
      tr.append(td(LONG_HOLD_TIER_META[r.tier].label), td(`${r.day}d`), td(String(r.checked)), td(String(r.survived)), td(String(r.winners)), rate, mult);
      body.appendChild(tr);
    }
    const checked = res.rows.reduce((s, r) => s + r.checked, 0);
    note.textContent = checked === 0 ? `${res.tracked} verdicts recorded \u2014 the first 7-day results arrive a week after the radar starts. Leave the browser running with the extension on.` : `${res.tracked} verdicts tracked \xB7 ${checked} checks completed.`;
  });
}
function loadAccuracy() {
  chrome.runtime.sendMessage({ type: "GET_ACCURACY" }, (res) => {
    const body = $("accuracy-body");
    const note = $("accuracy-note");
    if (!res || !res.ok) {
      note.textContent = "Report card unavailable.";
      return;
    }
    body.innerHTML = "";
    for (const b of res.accuracy.bands) {
      const tr = document.createElement("tr");
      const rate = document.createElement("td");
      rate.className = b.total === 0 ? "" : b.survivalPct >= 50 ? "pnl-pos" : "pnl-neg";
      rate.textContent = b.total === 0 ? "\u2014" : `${b.survivalPct}%`;
      tr.append(
        td(b.band),
        td(String(b.total)),
        td(String(b.rugged)),
        td(String(b.faded)),
        td(String(b.survived)),
        td(String(b.winners)),
        rate
      );
      body.appendChild(tr);
    }
    note.textContent = res.accuracy.totalChecked === 0 ? `No predictions scored yet \u2014 ${res.accuracy.pending} waiting on their 24h re-check. Come back tomorrow.` : `${res.accuracy.totalChecked} predictions scored \xB7 ${res.accuracy.pending} still pending.`;
  });
}
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
  const gradeBucket = $("f-signal").value;
  const minGrade = numOrNull($("f-min-score").value);
  const maxMcap = numOrNull($("f-max-mcap").value);
  const maxAge = numOrNull($("f-max-age").value);
  return (row) => {
    if (gradeBucket && gradeLabel(row.grade ?? null) !== gradeBucket) return false;
    if (minGrade !== null && (row.grade ?? -1) < minGrade) return false;
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
    score.textContent = row.insufficientData || row.grade == null ? "\u2014" : `${row.grade}%`;
    const signal = document.createElement("td");
    if (row.insufficientData || row.grade == null) {
      signal.textContent = "NO DATA";
    } else {
      const gc = gradeColors(row.grade);
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = gradeLabel(row.grade);
      badge.style.background = gc.color;
      badge.style.color = gc.textColor;
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
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(2)}`;
}
function fmtPrice(v) {
  return `$${v < 0.01 ? v.toFixed(8) : v.toFixed(4)}`;
}
function age(minutes) {
  if (minutes === null) return "\u2014";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
