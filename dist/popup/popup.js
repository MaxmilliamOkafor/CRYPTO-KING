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
  gemMinQuality: 30,
  /**
   * "Hide risky coins" cut-off, expressed in King Grade (higher = better) so the
   * toggle, the ⚠ counter and the % on each row all read the same direction.
   * 40 = the bottom of the MIXED band; WEAK/AVOID are hidden.
   */
  safeMinGrade: 40
};
var CACHE_TTL_MS = 5 * 6e4;
var LIMITS = {
  transferFeeHighBps: 1e3,
  // 10%
  transferFeeVeryHighBps: 2e3,
  // 20%
  sellSlippageMaxPct: 40,
  top10Pct: 60,
  singleWalletPct: 30,
  top5Pct: 80,
  top5MinHolders: 500,
  // "looks distributed but is effectively concentrated"
  bundledPct: 20,
  thinLiquidityEur: 5e4,
  thinLiqMcapEur: 5e5,
  microMcapEur: 5e4,
  youngAgeMinutes: 30,
  smartMoneyStrongWallets: 3,
  serialMinLaunches: 3,
  // serial-deployer factor needs at least this many prior coins…
  serialDeadRatio: 0.7,
  // …with at least this share dead/abandoned
  earlyWhalePct: 5,
  // % of TOTAL supply in one non-curve wallet while still on the curve
  earlyTop10Pct: 15,
  // % of TOTAL supply in top-10 non-curve wallets while on the curve
  devHoldsPct: 5
  // creator holdings at/above this % → devHoldingsHigh risk
};
var EXIT_REALITY = {
  /** Your typical position size (USD) — the card reports its real exit cost. */
  referencePositionUsd: 100,
  /** "Gentle" exit: price impact you'd barely notice. */
  gentleImpactPct: 2,
  /** Most you'd tolerate losing to slippage on the way out. */
  toleratedImpactPct: 5,
  /** If even a gentle exit is under this, the pool is unusably thin. */
  dangerouslyThinUsd: 50
};
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

// lib/exitReality.ts
function assessExitReality(market, mint, t = EXIT_REALITY) {
  const liquidity = market?.liquidityEur ?? null;
  const feePct = mint?.transferFeeBps != null ? mint.transferFeeBps / 100 : mint?.isToken2022 === false ? 0 : null;
  if (liquidity === null || liquidity <= 0) {
    return {
      maxGentleUsd: null,
      maxToleratedUsd: null,
      refPositionImpactPct: null,
      transferFeePct: feePct,
      note: "Liquidity unknown \u2014 exit cost cannot be estimated. Assume you may not get out cleanly."
    };
  }
  const reserve = liquidity / 2;
  const maxFor = (impact) => reserve * impact / (1 - impact);
  const maxGentleUsd = maxFor(t.gentleImpactPct / 100);
  const maxToleratedUsd = maxFor(t.toleratedImpactPct / 100);
  const ref = t.referencePositionUsd;
  const rawImpact = ref / (ref + reserve) * 100;
  const refPositionImpactPct = rawImpact + (feePct ?? 0);
  let note;
  if (maxGentleUsd < t.dangerouslyThinUsd) {
    note = `Dangerously thin: even a $${Math.round(maxGentleUsd)} exit moves the price. You likely cannot sell a real position without collapsing it.`;
  } else if (refPositionImpactPct > t.toleratedImpactPct) {
    note = `A $${ref} position would cost ~${refPositionImpactPct.toFixed(1)}% to exit. Size down to ~$${Math.round(maxToleratedUsd)} or less.`;
  } else {
    note = `A $${ref} position exits at ~${refPositionImpactPct.toFixed(1)}% cost. Rough ceiling before it hurts: ~$${Math.round(maxToleratedUsd)}.`;
  }
  return { maxGentleUsd, maxToleratedUsd, refPositionImpactPct, transferFeePct: feePct, note };
}

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
var LIVE_STATE_META = {
  DEAD: { label: "\u{1F480} ALREADY RUGGED/DEAD", color: "#7a1d1d", textColor: "#ffd9d9" },
  DUMPING: { label: "\u{1F4C9} DUMPING NOW", color: "#8a3a10", textColor: "#ffe0c9" },
  HEALTHY: { label: "no collapse detected", color: "#2e5a3c", textColor: "#c9f0d4" },
  UNKNOWN: { label: "momentum unknown", color: "#3a3f4c", textColor: "#e6e8ee" }
};

// lib/gemCriteria.ts
function gemBackgroundCheck(a, risk, quality) {
  const blockers = [];
  if (risk.insufficientData || quality.insufficientData) {
    blockers.push("Not enough data for a background check.");
    return { gem: false, blockers };
  }
  if (risk.riskScore > LIVE_FEED.notifyMaxScore) {
    blockers.push(`Too many weighted red flags to clear the gem gate (${risk.reasons.length} flag${risk.reasons.length === 1 ? "" : "s"}).`);
  }
  if (quality.qualityScore < LIVE_FEED.gemMinQuality) {
    blockers.push("Not enough positive signals yet (liquidity depth, holder spread, socials, age).");
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
function gradeBlurb(grade) {
  if (grade === null) return "Not enough verified data to grade this coin.";
  for (const bucket of GRADE_META) if (grade >= bucket.min) return bucket.blurb;
  return "Severe red flags \u2014 this looks like a scam/rug setup.";
}
function gradeColors(grade) {
  if (grade === null) return { color: "#3a3f4c", textColor: "#e6e8ee" };
  for (const bucket of GRADE_META) if (grade >= bucket.min) return { color: bucket.color, textColor: bucket.textColor };
  return { color: "#e5484d", textColor: "#ffffff" };
}

// lib/rugPotential.ts
function assessRugPotential(a, risk) {
  const hard = [];
  const soft = [];
  const unverified = [];
  const mint = a.mint;
  if (!mint) {
    unverified.push("mint/freeze authority");
  } else {
    if (mint.mintAuthorityActive === true) hard.push("Supply can be inflated (mint authority active).");
    if (mint.freezeAuthorityActive === true) hard.push("Your wallet can be frozen (freeze authority active).");
    if (mint.permanentDelegateActive === true) hard.push("Dev can seize tokens (permanent delegate).");
    if (mint.nonTransferable === true) hard.push("Token is soulbound \u2014 you cannot sell.");
    if (mint.defaultAccountFrozen === true) hard.push("New holder accounts start frozen.");
    if (mint.transferHookActive === true) hard.push("Transfers run dev code that can block sells.");
    if (mint.mintAuthorityActive === null) unverified.push("mint authority");
    if (mint.freezeAuthorityActive === null) unverified.push("freeze authority");
  }
  const sim = a.market?.sellSimulation;
  if (sim?.ok === false) hard.push("Simulated sell FAILS \u2014 honeypot behavior.");
  const lp = a.market?.lpStatus ?? "unknown";
  if (lp === "deployer_held") hard.push("Deployer holds the LP \u2014 liquidity can be pulled in one transaction.");
  else if (lp === "unlocked") soft.push("LP not burned/locked \u2014 liquidity can be pulled.");
  else if (lp === "unknown") unverified.push("LP burn/lock status");
  if (a.launch?.bondingCurveComplete === false) {
    soft.push("Still on the bonding curve \u2014 insiders can dump at any moment.");
  }
  const dev = a.holders?.devHoldsPct ?? null;
  if (dev !== null && dev >= LIMITS.devHoldsPct) soft.push(`Dev wallet holds ${dev.toFixed(1)}% \u2014 positioned to dump.`);
  const whale = a.holders?.largestNonLpWalletPct ?? null;
  if (whale !== null && whale > GEM_CRITERIA.maxLargestWalletPct) {
    soft.push(`A single wallet holds ${whale.toFixed(1)}% \u2014 one seller from a crash.`);
  }
  if (whale === null) unverified.push("holder concentration");
  if (risk.reasons.some((r) => /Serial launcher/.test(r.text))) {
    hard.push("Creator is a serial launcher with mostly dead coins.");
  }
  let verdict;
  if (hard.length > 0) verdict = "HIGH";
  else if (soft.length >= 2) verdict = "HIGH";
  else if (soft.length === 1) verdict = "POSSIBLE";
  else if (unverified.length > 0) verdict = "UNVERIFIED";
  else verdict = "LOW";
  return { verdict, vectors: [...hard, ...soft], unverified };
}
var RUG_VERDICT_META = {
  HIGH: { color: "#e5484d", textColor: "#ffffff", label: "\u{1F6A9} RUG POTENTIAL: HIGH" },
  POSSIBLE: { color: "#f76b15", textColor: "#ffffff", label: "\u{1F6A9} RUG POTENTIAL: POSSIBLE" },
  LOW: { color: "#2e5a3c", textColor: "#c9f0d4", label: "RUG VECTORS: none found (\u2260 safe)" },
  UNVERIFIED: { color: "#3a3f4c", textColor: "#e6e8ee", label: "RUG CHECK: not fully verified yet" }
};

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
  $("score-num").textContent = kg.grade === null ? "\u2014 no grade" : `${kg.grade}% King Grade`;
  $("grade-blurb").textContent = gradeBlurb(kg.grade);
  renderStatusBanner(analysis, risk);
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
  renderMetrics(analysis, quality);
  $("link-solscan").href = `https://solscan.io/token/${addr}`;
  $("link-rugcheck").href = `https://rugcheck.xyz/tokens/${addr}`;
  $("link-gmgn").href = `https://gmgn.ai/sol/token/${addr}`;
}
function renderStatusBanner(a, risk) {
  const el = $("status-banner");
  el.innerHTML = "";
  el.hidden = false;
  const live = assessLiveState(a.market);
  if (live.state === "DEAD" || live.state === "DUMPING") {
    const lm = LIVE_STATE_META[live.state];
    el.style.background = lm.color;
    el.style.color = lm.textColor;
    el.append(strong(lm.label));
    for (const r of live.reasons.slice(0, 2)) el.append(span(r));
    el.append(span("Do not enter \u2014 this is not an early opportunity."));
    return;
  }
  const rug = assessRugPotential(a, risk);
  const rm = RUG_VERDICT_META[rug.verdict];
  el.style.background = rm.color;
  el.style.color = rm.textColor;
  el.append(strong(rm.label));
  if (rug.vectors.length > 0) el.append(span(rug.vectors[0]));
  else if (rug.unverified.length > 0) el.append(span(`Unverified: ${rug.unverified.join(", ")}.`));
  if (rug.vectors.length > 1) el.append(span(`+${rug.vectors.length - 1} more open vector${rug.vectors.length > 2 ? "s" : ""}.`));
}
function strong(text) {
  const el = document.createElement("b");
  el.textContent = text;
  return el;
}
function span(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el;
}
function renderMetrics(a, quality) {
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
    // The grade is already the headline — this slot answers the question the
    // grade can't: how much money can you actually get back OUT of this pool?
    (() => {
      const exit = assessExitReality(a.market, a.mint);
      return {
        k: "Max exit (low slip)",
        v: exit.maxGentleUsd === null ? "unknown" : eur(exit.maxGentleUsd),
        cls: exit.maxGentleUsd !== null && exit.maxGentleUsd < 100 ? "bad" : void 0
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
