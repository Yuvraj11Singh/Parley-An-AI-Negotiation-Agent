// negotiation-intelligence.js — the single computational layer behind every
// piece of "negotiation intelligence" this iteration adds: the trajectory
// chart, the gap series, the phase timeline, key moments, seller behavior,
// and the per-negotiation autopsy. Every function here is a pure read over
// a canonical v2 record (negotiation-model.js) — nothing here recomputes
// state the backend already decided, and nothing here is stored separately
// from the record it was derived from. This is what lets the Deal Desk
// outcome screen, the Audit Trail, Replay, and the Dashboard all agree with
// each other: they all call these same functions over the same record.
//
// Terminology (Section 12): four distinct concepts, never conflated —
//   TARGET PRICE        record.targetPrice   — the user's own reference/budget figure
//   PARLEY'S RESERVATION record.buyerMax      — the maximum Parley will pay (revealed at outcome)
//   SELLER'S ASK         sellerAsk (per round) — the seller's current position
//   FINAL PRICE           record.dealPrice     — what was actually agreed (deals only)
// "Reservation price" is used instead of "authorized maximum" throughout —
// the walk-away safeguard copy was deliberately corrected away from
// authorization language in an earlier iteration, and that reasoning holds
// here too: Parley's maximum isn't an external permission, it's its own
// reservation price.

// --- trajectory (Section 1) -------------------------------------------
function computeTrajectory(record){
  const telemetry = record.telemetry || [];
  return {
    rounds: telemetry.map(t => t.roundNumber),
    sellerSeries: telemetry.map(t => t.sellerAsk),
    parleySeries: telemetry.map(t => t.agentOffer),
  };
}

// --- gap series (Section 2) ---------------------------------------------
// gap = seller's ask - Parley's offer, for every round where both exist.
// Already computed once per round as telemetry[i].diff — reused here
// rather than recalculated, so this can never drift from what the round
// actually recorded.
function computeGapSeries(record){
  return (record.telemetry || []).map(t => ({ round: t.roundNumber, gap: Math.max(0, t.diff) }));
}

function gapTrend(gapSeries){
  if (gapSeries.length < 2) return 'Opening';
  const first = gapSeries[0].gap, last = gapSeries[gapSeries.length - 1].gap;
  const eps = Math.max(1e-6, first * 0.02);
  if (last < first - eps) return 'Converging';
  if (last > first + eps) return 'Diverging';
  return 'Stable';
}

// --- phase timeline (Section 3) -----------------------------------------
// Reuses derivePhase (negotiation-model.js) for every non-final round, the
// same function already driving the live Negotiation Pulse, so a round
// never gets a different phase label depending on where it's displayed.
// The final round is overridden by the actual outcome (DEAL / WALK-AWAY /
// TIMEOUT) rather than guessed from the gap, since the real outcome is
// known. "EXPLORATION" is deliberately not used as a phase name here
// either, for the same reason the Pulse avoids it: the served policy is
// frozen and greedy and never explores during play.
function computePhaseTimeline(record){
  const telemetry = record.telemetry || [];
  if (!telemetry.length) return [];
  const openingGap = Math.max(1e-6, telemetry[0].diff);
  const maxRounds = record.maxRounds || 15;
  return telemetry.map((t, i) => {
    const isLast = i === telemetry.length - 1;
    if (isLast && record.outcome === 'deal') return { round: t.roundNumber, phase: 'DEAL' };
    if (isLast && record.outcome === 'walk') return { round: t.roundNumber, phase: 'WALK-AWAY' };
    if (isLast && record.outcome === 'timeout') return { round: t.roundNumber, phase: 'TIMEOUT' };
    return { round: t.roundNumber, phase: derivePhase(t.roundNumber, maxRounds, Math.max(0, t.diff), openingGap) };
  });
}

// --- key moments (Section 4) ---------------------------------------------
// Every moment here is a direct arithmetic fact about recorded rounds — no
// inferred motivation, no fabricated narrative (Sections 4 & 15).
function computeKeyMoments(record){
  const telemetry = record.telemetry || [];
  const moments = [];
  if (telemetry.length < 1) return moments;

  // largest seller concession
  let largestSellerDrop = 0, largestSellerRound = null;
  for (let i = 1; i < telemetry.length; i++){
    const drop = telemetry[i - 1].sellerAsk - telemetry[i].sellerAsk;
    if (drop > largestSellerDrop){ largestSellerDrop = drop; largestSellerRound = telemetry[i].roundNumber; }
  }
  if (largestSellerRound && largestSellerDrop > 0.01){
    moments.push({ round: largestSellerRound, type: 'seller_concession',
      text: `Seller made its largest concession, reducing the ask by ${fmtPrice(largestSellerDrop)}` });
  }

  // largest Parley concession
  let largestBuyerRise = 0, largestBuyerRound = null;
  telemetry.forEach(t => {
    if (t.changeFromPrevious && t.changeFromPrevious > largestBuyerRise){
      largestBuyerRise = t.changeFromPrevious; largestBuyerRound = t.roundNumber;
    }
  });
  if (largestBuyerRound){
    moments.push({ round: largestBuyerRound, type: 'parley_concession',
      text: `Parley made its largest move, raising its offer by ${fmtPrice(largestBuyerRise)}` });
  }

  // first holding-firm (strictly below the limit — AT LIMIT is a distinct, later moment)
  const firstHold = telemetry.find(t => t.state === 'HOLDING FIRM');
  if (firstHold){
    moments.push({ round: firstHold.roundNumber, type: 'holding_firm',
      text: `Parley held firm for the first time, keeping its offer at ${fmtPrice(firstHold.agentOffer)}` });
  }

  // first round Parley reached its reservation price
  const firstAtLimit = telemetry.find(t => t.state === 'AT LIMIT');
  if (firstAtLimit){
    moments.push({ round: firstAtLimit.roundNumber, type: 'at_limit',
      text: `Parley reached its reservation price of ${fmtPrice(firstAtLimit.agentOffer)}` });
  }

  // first major convergence: gap first drops to <=35% of the opening gap
  // (same CONVERGING threshold the phase timeline uses, for consistency)
  const openingGap = Math.max(1e-6, telemetry[0].diff);
  const convergeIdx = telemetry.findIndex(t => Math.max(0, t.diff) <= openingGap * PULSE_CONVERGING_GAP_FRACTION);
  if (convergeIdx > 0){
    const t = telemetry[convergeIdx];
    moments.push({ round: t.roundNumber, type: 'convergence',
      text: `Negotiation gap narrowed to ${fmtPrice(Math.max(0, t.diff))}, down from an opening gap of ${fmtPrice(openingGap)}` });
  }

  // closest round before the outcome (the round immediately before the last)
  if (telemetry.length >= 2){
    const beforeLast = telemetry[telemetry.length - 2];
    moments.push({ round: beforeLast.roundNumber, type: 'closest_before_outcome',
      text: `Gap stood at ${fmtPrice(Math.max(0, beforeLast.diff))} the round before the negotiation ended` });
  }

  // outcome moment itself
  const last = telemetry[telemetry.length - 1];
  if (record.outcome === 'deal'){
    moments.push({ round: last.roundNumber, type: 'deal', text: `Deal closed at ${fmtPrice(record.dealPrice)}` });
  } else if (record.outcome === 'walk'){
    const viaSafeguard = last.walkReason === 'safeguard' || last.walkReason === 'seller_stalled';
    moments.push({ round: last.roundNumber, type: 'walk',
      text: viaSafeguard ? 'The walk-away safeguard ended the negotiation — neither side had moved for several rounds'
                          : 'Parley chose to walk away from this negotiation' });
  } else if (record.outcome === 'timeout'){
    moments.push({ round: last.roundNumber, type: 'timeout', text: 'The negotiation reached its round limit without an agreement' });
  }

  return moments.sort((a, b) => a.round - b.round);
}

// --- seller behavior (Section 15) -----------------------------------------
// Neutral, observed-only language — no inferred intent ("desperate",
// "confident", etc.), matching the explicit instruction in Section 15.
function computeSellerBehavior(record){
  const telemetry = record.telemetry || [];
  if (telemetry.length < 1) return null;
  const initialAsk = telemetry[0].sellerAsk;
  const finalAsk = telemetry[telemetry.length - 1].sellerAsk;
  const totalConcession = Math.max(0, initialAsk - finalAsk);
  const totalConcessionPct = initialAsk > 0 ? (totalConcession / initialAsk) * 100 : 0;
  let largest = 0, stalledRounds = 0, moves = 0;
  for (let i = 1; i < telemetry.length; i++){
    const drop = telemetry[i - 1].sellerAsk - telemetry[i].sellerAsk;
    if (drop > 0.01){ moves++; if (drop > largest) largest = drop; }
    else stalledRounds++;
  }
  const movedRounds = Math.max(0, telemetry.length - 1);
  return {
    initialAsk, finalAsk, totalConcession, totalConcessionPct,
    largestConcession: largest,
    avgConcession: moves > 0 ? totalConcession / moves : 0,
    stalledRounds, movesCount: moves,
    movementFrequency: movedRounds > 0 ? (moves / movedRounds) * 100 : null,
  };
}

// --- autopsy (Section 6) — the structured post-negotiation summary --------
function computeAutopsy(record){
  const telemetry = record.telemetry || [];
  if (!telemetry.length) return null;
  const first = telemetry[0], last = telemetry[telemetry.length - 1];
  const gapSeries = computeGapSeries(record);
  return {
    outcome: record.outcome,
    finalPrice: record.outcome === 'deal' ? record.dealPrice : null,
    target: record.targetPrice,
    reservation: record.buyerMax,
    valueCaptured: record.valueCaptured,
    rounds: record.rounds.length,
    openingGap: Math.max(0, first.diff),
    finalGap: Math.max(0, last.diff),
    sellerInitialAsk: first.sellerAsk,
    sellerFinalAsk: last.sellerAsk,
    parleyInitialOffer: first.agentOffer,
    parleyFinalOffer: last.agentOffer,
    gapTrend: gapTrend(gapSeries),
    keyMoments: computeKeyMoments(record),
    sellerBehavior: computeSellerBehavior(record),
    phaseTimeline: computePhaseTimeline(record),
  };
}

// --- shared autopsy markup -------------------------------------------
// One HTML builder, used by both the Deal Desk outcome screen and the
// Audit Trail detail view, so the two can never show different numbers or
// different key moments for what is, underneath, the same computation over
// the same record (Section 18).
function buildAutopsyHtml(autopsy){
  if (!autopsy) return '';
  const outcomeLabel = autopsy.outcome === 'deal' ? 'Deal closed' : autopsy.outcome === 'walk' ? 'Walked away' : 'Timed out';
  const gapLine = autopsy.outcome === 'deal'
    ? `Reduced from ${fmtPrice(autopsy.openingGap)} to ${fmtPrice(0)}`
    : `${fmtPrice(autopsy.openingGap)} → ${fmtPrice(autopsy.finalGap)} (${autopsy.gapTrend.toLowerCase()})`;

  return `
    <div class="autopsy-card">
      <div class="autopsy-header">Negotiation Autopsy</div>
      <div class="autopsy-grid">
        <div><span>Outcome</span><b>${outcomeLabel}</b></div>
        <div><span>Rounds</span><b>${autopsy.rounds}</b></div>
        <div><span>Negotiation gap</span><b>${gapLine}</b></div>
        <div><span>Seller movement</span><b>${fmtPrice(autopsy.sellerInitialAsk)} → ${fmtPrice(autopsy.sellerFinalAsk)}</b></div>
      </div>
      ${autopsy.keyMoments.length ? `
        <div class="autopsy-moments">
          <div class="autopsy-moments-label">Key moments</div>
          <ul>
            ${autopsy.keyMoments.map(m => `<li><b>Round ${m.round}</b> — ${m.text}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

// --- aggregate stats across many negotiations (Sections 8-10) ------------
// One function, used by both the Dashboard home view and Agent Insights'
// "Your Negotiation Behavior" section, so the same underlying arithmetic
// never has to be written twice (and can't drift between the two pages).
// Every number here is a plain average/rate over actually-stored records —
// nothing is estimated or extrapolated.
function computeAggregateStats(records){
  const completed = records.filter(r => r.outcome);
  const deals = completed.filter(r => r.outcome === 'deal');
  const walks = completed.filter(r => r.outcome === 'walk');
  const timeouts = completed.filter(r => r.outcome === 'timeout');
  const n = completed.length;

  const withTelemetry = completed.filter(r => r.telemetry && r.telemetry.length >= 2);

  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  const sellerConcessions = withTelemetry.map(r => {
    const b = computeSellerBehavior(r);
    return b ? b.totalConcession : null;
  }).filter(v => v != null);

  const parleyConcessions = withTelemetry.map(r => {
    const t = r.telemetry;
    return Math.max(0, t[t.length - 1].agentOffer - t[0].agentOffer);
  });

  const closingGaps = completed.map(r => {
    const gaps = computeGapSeries(r);
    return gaps.length ? gaps[gaps.length - 1].gap : null;
  }).filter(v => v != null);

  const savings = deals.map(r => r.valueCaptured).filter(v => v != null);

  // average remaining gap at each round number, across every negotiation
  // that reached that round — the shape of a typical negotiation's
  // convergence, not any single one
  const gapByRound = {};
  withTelemetry.forEach(r => {
    computeGapSeries(r).forEach(({ round, gap }) => {
      (gapByRound[round] = gapByRound[round] || []).push(gap);
    });
  });
  const gapByRoundSeries = Object.keys(gapByRound)
    .map(Number).sort((a, b) => a - b)
    .map(round => ({ round, avgGap: avg(gapByRound[round]), count: gapByRound[round].length }));

  const byCategory = {};
  completed.forEach(r => {
    const cat = r.category || 'unknown';
    byCategory[cat] = byCategory[cat] || { total: 0, deals: 0 };
    byCategory[cat].total++;
    if (r.outcome === 'deal') byCategory[cat].deals++;
  });

  return {
    total: n,
    dealCount: deals.length, walkCount: walks.length, timeoutCount: timeouts.length,
    dealRate: n ? deals.length / n : null,
    walkRate: n ? walks.length / n : null,
    timeoutRate: n ? timeouts.length / n : null,
    avgRounds: avg(completed.map(r => r.rounds.length)),
    avgSavings: avg(savings),
    totalSavings: savings.reduce((s, v) => s + v, 0),
    avgSellerConcession: avg(sellerConcessions),
    avgParleyConcession: avg(parleyConcessions),
    avgClosingGap: avg(closingGaps),
    gapByRoundSeries,
    byCategory,
    sampleSize: withTelemetry.length,
  };
}

// --- agent behavior stats (Section 10, Agent Insights) --------------------
// Builds on computeAggregateStats' basics and adds the behavior-specific
// metrics Section 10 asks for: concession/holding-firm frequency, how many
// rounds typically pass before the first concession, and how far apart the
// two sides started. All computed from state labels and offers already
// recorded per round — nothing new tracked, nothing inferred.
function computeBehaviorStats(records){
  const base = computeAggregateStats(records);
  const completed = records.filter(r => r.outcome && r.telemetry && r.telemetry.length >= 1);
  const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  let concessionRounds = 0, holdRounds = 0, totalNonFinalRounds = 0;
  const roundsToFirstConcession = [];
  const openingDistances = [];

  completed.forEach(r => {
    const t = r.telemetry;
    let firstConcessionRound = null;
    t.forEach((round, i) => {
      const isFinal = i === t.length - 1;
      if (round.state === 'CONCESSION'){
        concessionRounds++;
        if (firstConcessionRound === null) firstConcessionRound = round.roundNumber;
      } else if (round.state === 'HOLDING FIRM' || round.state === 'AT LIMIT'){
        holdRounds++;
      }
      if (!isFinal || round.state !== 'DEAL') totalNonFinalRounds++;
    });
    if (firstConcessionRound !== null) roundsToFirstConcession.push(firstConcessionRound);
    if (t[0] && t[0].sellerAsk > 0) openingDistances.push(Math.max(0, t[0].diff) / t[0].sellerAsk);
  });

  return {
    ...base,
    concessionFrequency: totalNonFinalRounds ? (concessionRounds / totalNonFinalRounds) * 100 : null,
    holdFrequency: totalNonFinalRounds ? (holdRounds / totalNonFinalRounds) * 100 : null,
    avgRoundsToFirstConcession: avg(roundsToFirstConcession),
    avgOpeningDistance: avg(openingDistances),
  };
}

// --- shared seller-behavior markup -------------------------------------
function buildSellerBehaviorHtml(behavior){
  if (!behavior) return '';
  return `
    <div class="seller-behavior-card">
      <div class="autopsy-header">Seller Behavior</div>
      <div class="autopsy-grid">
        <div><span>Initial ask</span><b>${fmtPrice(behavior.initialAsk)}</b></div>
        <div><span>Final ask</span><b>${fmtPrice(behavior.finalAsk)}</b></div>
        <div><span>Total concession</span><b>${fmtPrice(behavior.totalConcession)} (${behavior.totalConcessionPct.toFixed(1)}%)</b></div>
        <div><span>Largest concession</span><b>${fmtPrice(behavior.largestConcession)}</b></div>
        <div><span>Rounds with no movement</span><b>${behavior.stalledRounds}</b></div>
        <div><span>Movement frequency</span><b>${behavior.movementFrequency != null ? behavior.movementFrequency.toFixed(0) + '%' : '—'}</b></div>
      </div>
    </div>
  `;
}
