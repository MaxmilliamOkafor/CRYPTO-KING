// config.ts
var LIVE_FEED = {
  enabled: true,
  /** How many newest coins to pull from the source each poll. */
  fetchCount: 80,
  /**
   * Max NEW coins to risk-scan per poll. Feed scans are LITE — one RPC call
   * (mint/freeze authority, the top rug check) + pump.fun. The default is tuned
   * to move fast on the public RPC without tripping its rate limit; with a
   * Helius key (see SOLANA.rpcUrl) push this to 30–50 for a real firehose.
   */
  scanBudgetPerPoll: 14,
  /** Parallel lite scans per poll (per-host rate limiter still applies). */
  scanConcurrency: 4,
  /** Panel auto-refresh / poll interval in ms. Lower = catch launches sooner
   *  (newest coins are scanned first each poll). 6s is aggressive but safe on
   *  the public RPC with lite scans; drop to 3–4s once you add a Helius key. */
  pollIntervalMs: 6e3,
  /** Drop coins older than this many minutes from the feed (keep it "fresh launches"). */
  maxAgeMinutes: 180,
  /** Feed cache size. */
  maxRows: 60,
  /**
   * Desktop notification when a fresh launch scans at or below notifyMaxScore
   * (with the on-chain authority checks actually completed). Framed as "lower
   * observed risk ≠ safe" — informational, never a buy signal.
   */
  notifyLowRisk: true,
  notifyMaxScore: 39,
  // CONSIDER / NEUTRAL territory
  /** "Low caps only" feed filter threshold (early-stage hunting ground).
   *  💎 gem-grade coins stay visible even above this cap. */
  lowCapMaxEur: 1e5,
  /**
   * 💎 gem-alert threshold: a feed coin pulses gold when risk ≤ notifyMaxScore
   * AND quality ≥ gemMinQuality. An attention aid for candidates worth YOUR
   * research — emphatically not a buy signal.
   */
  gemMinQuality: 30
};
var CACHE_TTL_MS = 5 * 6e4;
var LIVE_STATE = {
  /** Liquidity below this (USD) on a listed coin = effectively pulled. */
  deadLiquidityUsd: 1500,
  /** Price change ≤ this % (6h or 24h) = the collapse already happened. */
  deadDropPct: -70,
  /** Price change ≤ this % (1h or 6h) = actively dumping. */
  dumpingDropPct: -30,
  /** Sells > buys × this (1h) = holders exiting. */
  sellDominanceRatio: 1.8,
  /** Minimum 1h transactions before buy/sell flow is meaningful. */
  minTxnsForFlow: 15
};
var KING_GRADE = {
  safetyWeight: 0.5,
  // (100 - riskScore) share
  qualityWeight: 0.3,
  // qualityScore share
  coverageWeight: 0.2,
  // % of the 10 audit checks actually verified
  caps: {
    confirmedTrap: 10,
    // active mint/freeze auth, trap extension, honeypot, deployer-held LP
    highRisk: 15,
    // riskScore ≥ 60
    onBondingCurve: 40,
    // dev/insiders can dump any second
    partialData: 50,
    // holders or LP not verified yet
    noGemPass: 79
    // 80%+ is reserved for coins that passed the full background check
  }
};
var GRADE_META = [
  { min: 80, label: "GEM GRADE", color: "#d4a017", textColor: "#1b1b18" },
  { min: 60, label: "STRONG", color: "#46a758", textColor: "#ffffff" },
  { min: 40, label: "MIXED", color: "#ffb224", textColor: "#1b1b18" },
  { min: 20, label: "WEAK", color: "#f76b15", textColor: "#ffffff" },
  { min: 0, label: "AVOID", color: "#e5484d", textColor: "#ffffff" }
];
var GEM_CRITERIA = {
  /** Must be OFF the bonding curve (graduated) — on-curve devs can dump any second. */
  requireGraduated: true,
  /** LP must be burned or locked. */
  requireLpSecured: true,
  /** No single non-LP wallet may hold more than this % of supply. */
  maxLargestWalletPct: 10
  /** Risk score must be at or below LIVE_FEED.notifyMaxScore, quality at or above LIVE_FEED.gemMinQuality. */
};
var DISCLAIMER = "Meme coins are extremely speculative and frequently go to zero. This tool reduces some risks; it cannot detect all scams and does not guarantee profits. Only risk money you can afford to lose. Not financial advice.";

// lib/liveState.ts
function assessLiveState(market, t = LIVE_STATE) {
  if (!market) return { state: "UNKNOWN", reasons: ["No market data."] };
  const reasons = [];
  const { priceChange1h: h1, priceChange6h: h6, priceChange24h: h24, liquidityEur: liq, marketCapEur: mcap } = market;
  const haveMomentum = h1 !== null || h6 !== null || h24 !== null;
  let dead = false;
  if (liq !== null && liq < t.deadLiquidityUsd && (mcap === null || mcap > t.deadLiquidityUsd)) {
    dead = true;
    reasons.push(`Liquidity is only $${Math.round(liq)} \u2014 effectively pulled; you could not exit.`);
  }
  if (h24 !== null && h24 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h24))}% in 24h \u2014 this already collapsed.`);
  }
  if (h6 !== null && h6 <= t.deadDropPct) {
    dead = true;
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h \u2014 collapse in progress/complete.`);
  }
  if (dead) return { state: "DEAD", reasons };
  if (h1 !== null && h1 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h1))}% in the last hour \u2014 actively dumping.`);
  }
  if (h6 !== null && h6 <= t.dumpingDropPct) {
    reasons.push(`Price down ${Math.abs(Math.round(h6))}% in 6h \u2014 sustained bleed.`);
  }
  const { buys1h: buys, sells1h: sells } = market;
  if (buys !== null && sells !== null && buys + sells >= t.minTxnsForFlow && sells > buys * t.sellDominanceRatio) {
    reasons.push(`Sells dominating (${sells} sells vs ${buys} buys in 1h) \u2014 holders exiting.`);
  }
  if (reasons.length > 0) return { state: "DUMPING", reasons };
  if (!haveMomentum) return { state: "UNKNOWN", reasons: ["No price-momentum data yet (unlisted/too fresh)."] };
  return { state: "HEALTHY", reasons: [] };
}

// lib/gemCriteria.ts
function gemBackgroundCheck(a, risk, quality) {
  const blockers = [];
  if (risk.insufficientData || quality.insufficientData) {
    blockers.push("Not enough data for a background check.");
    return { gem: false, blockers };
  }
  if (risk.riskScore > LIVE_FEED.notifyMaxScore) {
    blockers.push(`Risk score ${risk.riskScore} above the ${LIVE_FEED.notifyMaxScore} gate.`);
  }
  if (quality.qualityScore < LIVE_FEED.gemMinQuality) {
    blockers.push(`Quality ${quality.qualityScore} below the ${LIVE_FEED.gemMinQuality} gate.`);
  }
  if (GEM_CRITERIA.requireGraduated && a.launch?.bondingCurveComplete === false) {
    blockers.push("Still on the bonding curve \u2014 dev/insiders can dump at any moment.");
  }
  const lp = a.market?.lpStatus ?? "unknown";
  if (GEM_CRITERIA.requireLpSecured && lp !== "burned" && lp !== "locked") {
    blockers.push(lp === "unknown" ? "LP status not verified yet." : `LP not secured (${lp.replace("_", " ")}).`);
  }
  const largest = a.holders?.largestNonLpWalletPct ?? null;
  if (largest === null) {
    blockers.push("Holder distribution not verified yet.");
  } else if (largest > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`A single wallet holds ${largest.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (a.launch?.platform === "pumpfun" && dev === null) {
    blockers.push("Dev wallet holdings not verified yet \u2014 cannot clear it as gem grade.");
  } else if (dev !== null && dev > GEM_CRITERIA.maxLargestWalletPct) {
    blockers.push(`Dev wallet holds ${dev.toFixed(1)}% (max ${GEM_CRITERIA.maxLargestWalletPct}% for gem grade).`);
  }
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") {
    blockers.push(`Already rugged/dead: ${live.reasons[0] ?? "market collapsed."}`);
  } else if (live.state === "DUMPING") {
    blockers.push(`Dumping right now: ${live.reasons[0] ?? "price falling hard."}`);
  }
  if (a.deployer === null || a.deployer.priorLaunches === null && a.launch?.platform === "pumpfun") {
    blockers.push("Creator's launch history not checked yet.");
  }
  return { gem: blockers.length === 0, blockers };
}

// lib/kingGrade.ts
var known = (v) => v !== null && v !== void 0;
function computeKingGrade(a, risk, quality) {
  if (risk.insufficientData) {
    return { grade: null, label: "NO DATA", caps: [], parts: { safety: 0, quality: 0, coveragePct: 0 } };
  }
  const checks = [
    known(a.mint?.mintAuthorityActive),
    known(a.mint?.freezeAuthorityActive),
    known(a.mint?.permanentDelegateActive),
    // Token-2022 trap extensions readable
    known(a.mint?.metadataMutable),
    a.market !== null && a.market.lpStatus !== "unknown",
    known(a.holders?.top10Pct),
    known(a.holders?.largestNonLpWalletPct),
    a.market?.sellSimulation != null,
    known(a.deployer?.priorLaunches),
    a.socials !== null
  ];
  const coveragePct = checks.filter(Boolean).length / checks.length * 100;
  const safety = 100 - risk.riskScore;
  const raw = Math.min(
    100,
    Math.max(
      0,
      KING_GRADE.safetyWeight * safety + KING_GRADE.qualityWeight * quality.qualityScore + KING_GRADE.coverageWeight * coveragePct
    )
  );
  const caps = [];
  let ceiling = 100;
  const applyCap = (limit, why) => {
    if (limit < ceiling) ceiling = limit;
    if (raw > limit) caps.push(`Ceiling ${limit}%: ${why}`);
  };
  const confirmedTrap = a.mint?.mintAuthorityActive === true || a.mint?.freezeAuthorityActive === true || a.mint?.permanentDelegateActive === true || a.mint?.nonTransferable === true || a.mint?.defaultAccountFrozen === true || a.market?.sellSimulation?.ok === false || a.market?.lpStatus === "deployer_held";
  const live = assessLiveState(a.market);
  if (live.state === "DEAD") applyCap(KING_GRADE.caps.confirmedTrap, "already rugged/dead \u2014 market collapsed.");
  else if (live.state === "DUMPING") applyCap(KING_GRADE.caps.highRisk, "dumping right now.");
  if (confirmedTrap) applyCap(KING_GRADE.caps.confirmedTrap, "confirmed trap/rug mechanic present.");
  if (risk.riskScore >= 60) applyCap(KING_GRADE.caps.highRisk, "risk score 60+.");
  if (a.launch?.bondingCurveComplete === false) {
    applyCap(KING_GRADE.caps.onBondingCurve, "still on the bonding curve \u2014 dev can dump any second.");
  }
  if (!known(a.holders?.largestNonLpWalletPct) || a.market === null || a.market.lpStatus === "unknown") {
    applyCap(KING_GRADE.caps.partialData, "holders/LP not verified yet \u2014 run the full scan.");
  }
  if (!gemBackgroundCheck(a, risk, quality).gem) {
    applyCap(KING_GRADE.caps.noGemPass, "80%+ is reserved for coins that pass the full background check.");
  }
  let gradeF;
  if (raw <= ceiling) {
    gradeF = raw;
  } else {
    const band = Math.min(22, ceiling);
    gradeF = ceiling - band + band * ((raw - ceiling) / (100 - ceiling));
  }
  const grade = Math.round(Math.min(ceiling, Math.max(0, gradeF)));
  return { grade, label: gradeLabel(grade), caps, parts: { safety, quality: quality.qualityScore, coveragePct } };
}
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

// popup/popup.ts
var BASE58 = "[1-9A-HJ-NP-Za-km-z]{32,44}";
var URL_PATTERNS = [
  new RegExp(`/sol/token/(${BASE58})(?:[/?#]|$)`),
  new RegExp(`/coin/(${BASE58})(?:[/?#]|$)`)
];
var $ = (id) => document.getElementById(id);
document.addEventListener("DOMContentLoaded", () => {
  $("disclaimer").textContent = DISCLAIMER;
  $("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  });
  initSettings();
  void init();
});
function initSettings() {
  const input = $("helius-key");
  const status = $("turbo-status");
  const msg = $("settings-msg");
  const xInput = $("x-token");
  const xStatus = $("x-status");
  const xMsg = $("x-msg");
  const paint = (res) => {
    if (!res || !res.ok) return;
    status.textContent = res.hasHelius ? "ON" : "off";
    status.className = res.hasHelius ? "turbo-on" : "turbo-off";
    if (res.hasHelius) input.placeholder = "Helius key saved \u2713 (paste a new one to change)";
    xStatus.textContent = res.hasX ? "ON" : "off";
    xStatus.className = res.hasX ? "turbo-on" : "turbo-off";
    if (res.hasX) xInput.placeholder = "X token saved \u2713 (paste a new one to change)";
  };
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, paint);
  $("save-key").addEventListener("click", () => {
    const key = input.value.trim();
    msg.textContent = "Saving\u2026";
    msg.className = "settings-msg";
    chrome.runtime.sendMessage({ type: "SET_SETTINGS", heliusKey: key || null }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        msg.textContent = "Could not save.";
        msg.className = "settings-msg err";
        return;
      }
      input.value = "";
      paint(res);
      msg.textContent = res.hasHelius ? "\u26A1 Turbo ON \u2014 scanning 3\xD7 more coins, faster. Re-scan of everything started." : "Key cleared \u2014 back to the free public RPC.";
      msg.className = "settings-msg ok";
    });
  });
  $("save-x").addEventListener("click", () => {
    const token = xInput.value.trim();
    xMsg.textContent = "Saving\u2026";
    xMsg.className = "settings-msg";
    chrome.runtime.sendMessage({ type: "SET_SETTINGS", xBearerToken: token || null }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        xMsg.textContent = "Could not save.";
        xMsg.className = "settings-msg err";
        return;
      }
      xInput.value = "";
      paint(res);
      xMsg.textContent = res.hasX ? "\u{1D54F} automated buzz ON." : "X token cleared \u2014 live search still works.";
      xMsg.className = "settings-msg ok";
    });
  });
}
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const address = extractAddress(tab?.url ?? "");
  if (!address) {
    await showRecent();
    return;
  }
  $("state").textContent = "Analyzing token\u2026";
  chrome.runtime.sendMessage({ type: "ANALYZE_TOKEN", address }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $("state").textContent = "Risk data unavailable.";
      return;
    }
    if (!res.ok) {
      $("state").textContent = res.error;
      return;
    }
    render(res.analysis, res.risk, res.quality, res.mock);
  });
}
function extractAddress(url) {
  try {
    const path = new URL(url).pathname;
    for (const re of URL_PATTERNS) {
      const m = path.match(re);
      if (m) return m[1];
    }
  } catch {
  }
  return null;
}
function render(analysis, risk, quality, mock) {
  $("state").hidden = true;
  $("mock-badge").hidden = !mock;
  if (risk.insufficientData) {
    $("state").hidden = false;
    $("state").textContent = "Not enough data to assess this token \u2014 no score shown.";
    return;
  }
  $("result").hidden = false;
  const addr = analysis.identity.address;
  $("token-symbol").textContent = analysis.identity.symbol ?? "(unknown symbol)";
  $("token-address").textContent = addr;
  const kg = computeKingGrade(analysis, risk, quality);
  const gc = gradeColors(kg.grade);
  const badge = $("signal-badge");
  badge.textContent = kg.grade === null ? "NO DATA" : gradeLabel(kg.grade);
  badge.style.background = gc.color;
  badge.style.color = gc.textColor;
  const fill = $("score-fill");
  fill.style.width = `${kg.grade ?? 0}%`;
  fill.style.background = gc.color;
  $("score-num").textContent = kg.grade === null ? "\u2014 / 100" : `${kg.grade}% King Grade`;
  const reasons = $("reasons");
  reasons.innerHTML = "";
  if (risk.reasons.length === 0) {
    reasons.appendChild(li("gap-item", "No individual risk factors triggered \u2014 low observed risk \u2260 safe."));
  }
  for (const r of risk.reasons.slice(0, 6)) {
    reasons.appendChild(reasonLi(`+${r.points}`, r.text, "bad"));
  }
  const mitigations = $("mitigations");
  mitigations.innerHTML = "";
  for (const m of risk.mitigations) {
    mitigations.appendChild(reasonLi(`${m.points}`, m.text, "good"));
  }
  const gaps = $("gaps");
  gaps.innerHTML = "";
  for (const g of risk.dataGaps) gaps.appendChild(li("gap-item", g));
  $("gaps-details").hidden = risk.dataGaps.length === 0;
  renderMetrics(analysis, risk, quality);
  $("link-solscan").href = `https://solscan.io/token/${addr}`;
  $("link-rugcheck").href = `https://rugcheck.xyz/tokens/${addr}`;
  $("link-gmgn").href = `https://gmgn.ai/sol/token/${addr}`;
}
function renderMetrics(a, risk, quality) {
  const m = a.market;
  const h = a.holders;
  const mint = a.mint;
  const lpText = {
    burned: { v: "Burned", cls: "good" },
    locked: { v: "Locked", cls: "good" },
    deployer_held: { v: "Deployer-held", cls: "bad" },
    unlocked: { v: "Unlocked", cls: "bad" },
    unknown: { v: "unknown", cls: "unknown" }
  };
  const lp = lpText[m?.lpStatus ?? "unknown"];
  const metrics = [
    { k: "Liquidity", v: eur(m?.liquidityEur) },
    { k: "Market cap", v: eur(m?.marketCapEur) },
    { k: "Top-10 holders", v: pct(h?.top10Pct), cls: h?.top10Pct != null && h.top10Pct > 60 ? "bad" : void 0 },
    { k: "Token age", v: age(a.identity.ageMinutes) },
    {
      k: "Transfer fee",
      v: mint?.transferFeeBps != null ? `${(mint.transferFeeBps / 100).toFixed(1)}%` : mint?.isToken2022 === false ? "0% (SPL)" : "unknown",
      cls: mint?.transferFeeBps != null && mint.transferFeeBps > 1e3 ? "bad" : void 0
    },
    { k: "LP status", v: lp.v, cls: lp.cls },
    ...authorityMetric("Mint authority", mint?.mintAuthorityActive ?? null),
    ...authorityMetric("Freeze authority", mint?.freezeAuthorityActive ?? null),
    {
      k: "Quality signals",
      v: quality.insufficientData ? "unknown" : `${quality.qualityScore}/100`,
      cls: !quality.insufficientData && quality.qualityScore >= 50 ? "good" : void 0
    },
    (() => {
      const kg = computeKingGrade(a, risk, quality);
      return {
        k: "King Grade",
        v: kg.grade === null ? "unknown" : `${kg.grade}% ${gradeLabel(kg.grade)}`,
        cls: kg.grade !== null && kg.grade >= 60 ? "good" : kg.grade !== null && kg.grade < 20 ? "bad" : void 0
      };
    })()
  ];
  const grid = $("metrics");
  grid.innerHTML = "";
  for (const item of metrics) {
    const div = document.createElement("div");
    div.className = "metric";
    const k = document.createElement("div");
    k.className = "k";
    k.textContent = item.k;
    const v = document.createElement("div");
    v.className = `v ${item.v === "unknown" ? "unknown" : item.cls ?? ""}`;
    v.textContent = item.v;
    div.append(k, v);
    grid.appendChild(div);
  }
}
function authorityMetric(label, active) {
  if (active === null) return [{ k: label, v: "unknown" }];
  return [{ k: label, v: active ? "ACTIVE" : "Revoked", cls: active ? "bad" : "good" }];
}
async function showRecent() {
  $("state").hidden = true;
  $("no-token").hidden = false;
  chrome.runtime.sendMessage({ type: "GET_RECENT" }, (res) => {
    const list = $("recent-list");
    list.innerHTML = "";
    if (!res?.ok || res.recent.length === 0) {
      list.appendChild(li("gap-item", "Nothing analyzed yet."));
      return;
    }
    for (const row of res.recent.slice(0, 8)) {
      const gc = gradeColors(row.grade ?? null);
      const item = document.createElement("li");
      const sym = document.createElement("span");
      sym.className = "sym";
      sym.textContent = row.symbol ?? `${row.address.slice(0, 4)}\u2026${row.address.slice(-4)}`;
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = row.grade == null ? "NO DATA" : `${row.grade}% ${gradeLabel(row.grade)}`;
      badge.style.background = gc.color;
      badge.style.color = gc.textColor;
      item.append(sym, badge);
      list.appendChild(item);
    }
  });
}
function li(cls, text) {
  const el = document.createElement("li");
  el.className = cls;
  el.textContent = text;
  return el;
}
function reasonLi(points, text, cls) {
  const el = document.createElement("li");
  const pts = document.createElement("span");
  pts.className = `pts ${cls}`;
  pts.textContent = points;
  const txt = document.createElement("span");
  txt.textContent = text;
  el.append(pts, txt);
  return el;
}
function eur(v) {
  if (v == null) return "unknown";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(v < 1 ? 6 : 2)}`;
}
function pct(v) {
  return v == null ? "unknown" : `${v.toFixed(0)}%`;
}
function age(minutes) {
  if (minutes == null) return "unknown";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}
