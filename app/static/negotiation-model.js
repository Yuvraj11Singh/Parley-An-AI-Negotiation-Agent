// Canonical negotiation data model — the single source of truth for how a
// negotiation record is shaped, both when it's created (script.js, on the
// Deal Desk) and when it's read back (dashboard.js, in later checkpoints).
// See master-prompt Section 12 (canonical negotiation state) and Section
// 4.4 (decision telemetry).
//
// Backward compatibility approach: MIGRATE ON LOAD. Records already in
// localStorage use the pre-existing ("v1") shape:
//   { id, timestamp, startedAt, category, itemId, itemName, referencePrice,
//     sellerMin, rounds: [{round, ask, offer, at}], outcome, dealPrice,
//     buyerMax }
// Every one of those fields is kept, unchanged, in the new ("v2") shape —
// existing readers (today's dashboard.js) keep working against v2 records
// without modification. `normalizeNegotiationRecord` upgrades a v1 record
// to v2 the first time it's read, backfilling fields the old record never
// had with `null` ("not recorded") rather than a guessed value. Nothing is
// deleted; the original fields are preserved via spread.

const NEGOTIATION_SCHEMA_VERSION = 2;

// --- price formatting --------------------------------------------------
// Display only — never touches the value sent to or stored from the
// backend. Every price shown anywhere on the Deal Desk, in statements, or
// in the Audit Trail goes through this one function. Named fmtPrice (not
// fmtMoney) deliberately — dashboard.js already defines its own fmtMoney
// for the Dashboard home view's big numbers, with different rounding
// behavior; this stays out of its way rather than silently shadowing it.
function fmtPrice(n){
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- round-level state derivation (business-level only) --------------------
// Unchanged behavior from the existing Deal Desk — relocated here so it's
// computed in exactly one place as more parts of the app come to need it.
// `atLimit` is a boolean only (never buyer_max itself) telling us this
// round's offer sat at Parley's hidden maximum and didn't change — distinct
// from HOLDING FIRM, which is "chose not to move while still below max".
function deriveRoundState(roundNumber, prevOffer, newOffer, outcome, done, atLimit){
  if (done){
    if (outcome === 'deal') return { cls: 'deal', label: 'DEAL' };
    if (outcome === 'walk') return { cls: 'walk', label: 'WALK-AWAY' };
    return { cls: 'timeout', label: 'TIMEOUT' };
  }
  if (roundNumber <= 1) return { cls: 'counter', label: 'COUNTER' };
  if (prevOffer !== null && newOffer > prevOffer + 0.05) return { cls: 'concession', label: 'CONCESSION' };
  if (atLimit) return { cls: 'limit', label: 'AT LIMIT' };
  return { cls: 'ask', label: 'HOLDING FIRM' };
}

// --- per-round telemetry (Section 4.4) --------------------------------------
// Everything Section 4.4 asks for, computed once per round.
function buildRoundTelemetry({ roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done, atLimit, walkReason, statement }){
  const state = deriveRoundState(roundNumber, prevOffer, agentOffer, outcome, done, atLimit);
  return {
    roundNumber,
    sellerAsk,
    agentOffer,
    diff: +(sellerAsk - agentOffer).toFixed(2),
    changeFromPrevious: prevOffer !== null ? +(agentOffer - prevOffer).toFixed(2) : null,
    action: (action === null || action === undefined) ? null : action,
    state: state.label,
    stateClass: state.cls,
    timestamp: new Date().toISOString(),
    outcome: done ? outcome : null,
    atLimit: !!atLimit,
    // "agent" | "safeguard" | "seller_stalled" | null — null (including for
    // records recorded before this field existed) is read as an agent walk,
    // never a guess
    walkReason: (outcome === 'walk' && done) ? (walkReason || 'agent') : null,
    // the exact words shown on the Deal Desk for this round, so the Audit
    // Trail replays the same statement rather than regenerating one —
    // undefined/missing on records saved before this feature existed,
    // and deliberately never backfilled (see normalizeNegotiationRecord)
    statement: statement || null,
  };
}

// --- canonical negotiation record (Section 12) ------------------------------

function createNegotiationRecord({ category, itemId, itemName, referencePrice, quantity, requirements, preferences, sellerMin, maxRounds }){
  const now = new Date().toISOString();
  const reqList = (requirements && requirements.length) ? requirements : null;
  const prefList = (preferences && preferences.length) ? preferences : null;
  return {
    // v1 fields — unchanged shape, so existing readers keep working
    id: Date.now(),
    timestamp: now,
    startedAt: now,
    category,
    itemId,
    itemName,
    referencePrice,
    sellerMin,
    rounds: [],
    outcome: null,
    dealPrice: null,
    buyerMax: null,

    // v2 (canonical) fields
    schemaVersion: NEGOTIATION_SCHEMA_VERSION,
    createdAt: now,
    quantity: quantity ?? null,
    // the setup form already collects this as "target price" — it's the
    // user's own reference/budget figure, never the agent's hidden max
    targetPrice: referencePrice ?? null,
    // "Requirements" from setup doubles as the hard-constraint bucket — the
    // current engine negotiates price only, so these are recorded context,
    // never something Parley trades on
    requirements: reqList,
    constraints: reqList,
    preferences: prefList,  // soft, nice-to-have — also not negotiated by the current engine
    priorities: null,       // no priority-ranking UI yet — left honestly null, not guessed
    seller: null,           // no seller-identity concept exists yet
    concessionInventory: buildConcessionInventory({ quantity, constraints: reqList }),
    dealTerms: buildDealTerms({ category, quantity, requirements: reqList, preferences: prefList }),
    // the round budget this negotiation ran under — needed to compute the
    // phase timeline consistently later (how close a round is to the round
    // limit). Old records never recorded it; normalizeNegotiationRecord
    // falls back to the backend's MAX_ROUNDS (15), which has never changed.
    maxRounds: maxRounds ?? 15,
    telemetry: [],
    finalPrice: null,
    valueCaptured: null,
    analytics: {},
  };
}

function pushNegotiationRound(record, { roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done, atLimit, walkReason, statement, statementLabel }){
  // v1 shape, plus the two additive fields dashboard.js's Audit Trail reads
  // directly (it never goes through normalizeNegotiationRecord) — old
  // records simply won't have these keys, which is exactly the "not
  // recorded" signal the display logic checks for
  record.rounds.push({
    round: roundNumber, ask: sellerAsk, offer: agentOffer, at: new Date().toISOString(),
    statement: statement || null, statementLabel: statementLabel || null, atLimit: !!atLimit,
  });
  // v2 telemetry, additive
  record.telemetry.push(buildRoundTelemetry({ roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done, atLimit, walkReason, statement }));
}

function finalizeNegotiationRecord(record, outcome, dealPrice, buyerMax, walkReason, safeguardHoldRounds){
  record.outcome = outcome;
  record.dealPrice = dealPrice || null;
  record.buyerMax = buyerMax || null;
  // "agent" | "safeguard" | "seller_stalled" | null — null is only possible
  // for outcomes other than 'walk'; a missing value on an old record is
  // read as an agent walk
  record.walkReason = outcome === 'walk' ? (walkReason || 'agent') : null;
  // only meaningful when walkReason is "safeguard"/"seller_stalled" — null
  // on older records, which the display logic reads as "not recorded"
  record.safeguardHoldRounds = (outcome === 'walk' && safeguardHoldRounds) ? safeguardHoldRounds : null;

  record.finalPrice = outcome === 'deal' ? (dealPrice || null) : null;
  record.valueCaptured = (outcome === 'deal' && dealPrice != null && buyerMax != null)
    ? +Math.max(0, buyerMax - dealPrice).toFixed(2)
    : null;
  record.analytics = {
    roundCount: record.rounds.length,
    durationMs: record.startedAt ? (Date.now() - new Date(record.startedAt).getTime()) : null,
  };
  return record;
}

// --- storage: one place that reads/writes parley_audit_trail ---------------

const AUDIT_TRAIL_KEY = 'parley_audit_trail';
const AUDIT_TRAIL_CAP = 50;

function normalizeNegotiationRecord(raw){
  if (raw && raw.schemaVersion >= NEGOTIATION_SCHEMA_VERSION) return raw;
  const rounds = Array.isArray(raw.rounds) ? raw.rounds : [];
  // old records never captured per-round telemetry — reconstruct what we
  // honestly can from `rounds` (state can be re-derived; `action` cannot,
  // since it was never recorded, so it stays null rather than guessed)
  const telemetry = rounds.map((r, i) => {
    const prevOffer = i > 0 ? rounds[i - 1].offer : null;
    const isLast = i === rounds.length - 1;
    return buildRoundTelemetry({
      roundNumber: r.round,
      sellerAsk: r.ask,
      agentOffer: r.offer,
      prevOffer,
      action: null,
      outcome: raw.outcome,
      done: isLast,
      // pre-safeguard records never captured either field — false/agent are
      // the honest "not recorded" defaults, not guesses
      atLimit: r.atLimit ?? false,
      walkReason: isLast ? (raw.walkReason || 'agent') : null,
      // records saved before the negotiation-language system existed never
      // captured this — left null, never generated after the fact
      statement: r.statement || null,
    });
  });
  return {
    ...raw,
    schemaVersion: NEGOTIATION_SCHEMA_VERSION,
    walkReason: raw.outcome === 'walk' ? (raw.walkReason || 'agent') : null,
    createdAt: raw.createdAt || raw.startedAt || raw.timestamp || null,
    quantity: raw.quantity ?? null,
    targetPrice: raw.targetPrice ?? (raw.referencePrice ?? null),
    requirements: raw.requirements ?? null,
    constraints: raw.constraints ?? raw.requirements ?? null,
    preferences: raw.preferences ?? null,
    priorities: raw.priorities ?? null,
    seller: raw.seller ?? null,
    concessionInventory: raw.concessionInventory ?? buildConcessionInventory({
      quantity: raw.quantity ?? null,
      constraints: raw.constraints ?? raw.requirements ?? null,
    }),
    dealTerms: raw.dealTerms ?? buildDealTerms({
      category: raw.category, quantity: raw.quantity ?? null,
      requirements: raw.requirements ?? null, preferences: raw.preferences ?? null,
    }),
    maxRounds: raw.maxRounds ?? 15,
    telemetry,
    finalPrice: raw.finalPrice ?? (raw.outcome === 'deal' ? (raw.dealPrice ?? null) : null),
    valueCaptured: raw.valueCaptured ?? ((raw.outcome === 'deal' && raw.dealPrice != null && raw.buyerMax != null)
      ? +Math.max(0, raw.buyerMax - raw.dealPrice).toFixed(2)
      : null),
    analytics: (raw.analytics && Object.keys(raw.analytics).length) ? raw.analytics : {
      roundCount: rounds.length,
      durationMs: null, // not recorded for pre-existing negotiations
    },
  };
}

// Named loadNegotiationRecords (not loadAuditTrail) deliberately — dashboard.js
// already has its own loadAuditTrail(filterText) that renders into the DOM;
// this just returns normalized data, so the two can't collide if a page
// loads both scripts.
function loadNegotiationRecords(){
  let existing;
  try {
    existing = JSON.parse(localStorage.getItem(AUDIT_TRAIL_KEY) || '[]');
  } catch (e) {
    existing = [];
  }
  return existing.map(normalizeNegotiationRecord);
}

function saveNegotiationRecord(record){
  const existing = loadNegotiationRecords();
  existing.unshift(record);
  if (existing.length > AUDIT_TRAIL_CAP) existing.length = AUDIT_TRAIL_CAP; // cap stored history
  localStorage.setItem(AUDIT_TRAIL_KEY, JSON.stringify(existing));
}

// --- deal intelligence: concession inventory (Phase 2.4) -------------------
// What Parley can move on vs. what's protected. The current engine only
// ever negotiates price — everything else the user records is context that
// travels with the deal, not something traded yet. This is intentionally a
// plain data structure (not a UI), so a future multi-issue engine can read
// it without the data model changing again.
function buildConcessionInventory({ quantity, constraints }){
  const protectedTerms = [];
  if (quantity) protectedTerms.push('Quantity');
  (constraints || []).forEach(c => protectedTerms.push(c));
  return {
    negotiable: ['Price'],
    protected: protectedTerms,
    potentialTrades: [], // foundation for "I can improve X if I receive Y" — none representable yet
  };
}

// --- multi-issue negotiation foundation --------------------------------
// A structured representation of every term a real deal can carry — price,
// quantity, and whatever category-relevant specs the item brought with it
// (delivery, warranty, install, SLA, contract term, etc., arriving via
// `requirements`/`preferences`, however the category happened to phrase
// them). This is DATA MODEL ONLY: today's Q-learning agent negotiates price
// alone, and every non-price term here is marked `negotiable: false` for
// exactly that reason — it is not pretending the agent trades on them. The
// purpose is so a future multi-issue engine has a structure to populate
// without another data-model migration; nothing here changes how the
// current negotiation runs.
function buildDealTerms({ category, quantity, requirements, preferences }){
  const terms = [
    { key: 'price', label: 'Price', negotiable: true, value: null },
  ];
  if (quantity){
    terms.push({ key: 'quantity', label: 'Quantity', negotiable: false, value: quantity });
  }
  (requirements || []).forEach((r, i) => {
    terms.push({ key: `requirement_${i}`, label: r, negotiable: false, value: r, kind: 'requirement' });
  });
  (preferences || []).forEach((p, i) => {
    terms.push({ key: `preference_${i}`, label: p, negotiable: false, value: p, kind: 'preference' });
  });
  return { category: category ?? null, terms };
}

// --- deal intelligence: negotiation position & phase (Phase 3.1, 3.4) ------
// Both are derived purely from observable gap movement — no fabricated
// reasoning, no information the backend doesn't already expose.

function derivePosition(gapNow, gapPrev){
  if (gapPrev === null || gapPrev === undefined) return 'Opening';
  const eps = Math.max(1e-6, Math.abs(gapPrev) * 0.001);
  if (gapNow < gapPrev - eps) return 'Narrowing';
  if (gapNow > gapPrev + eps) return 'Widening';
  return 'Stable';
}

// Named thresholds for the Negotiation Pulse's 4-stage progression
// (OPENING -> COUNTERING -> CONVERGING -> CLOSING), the only inputs
// derivePhase() uses. Both are fractions, not absolute prices, so they
// apply the same way regardless of the deal's price scale.
const PULSE_CLOSING_GAP_FRACTION = 0.05;    // gap has closed to <=5% of its round-1 size
const PULSE_CLOSING_ROUND_FRACTION = 0.85;  // or we're past 85% of the round budget
const PULSE_CONVERGING_GAP_FRACTION = 0.35; // gap has closed to <=35% of its round-1 size

// Deterministic: the same (round, gapNow, openingGap) always returns the
// same phase. "Exploration"/"Exploring" is deliberately never used here —
// the served policy is frozen and greedy and never explores during play.
function derivePhase(round, maxRounds, gapNow, openingGap){
  if (round <= 1) return 'OPENING';
  const roundFrac = round / Math.max(1, maxRounds);
  const gapFrac = openingGap > 0 ? Math.max(0, gapNow) / openingGap : 0;
  if (gapFrac <= PULSE_CLOSING_GAP_FRACTION || roundFrac >= PULSE_CLOSING_ROUND_FRACTION) return 'CLOSING';
  if (gapFrac <= PULSE_CONVERGING_GAP_FRACTION) return 'CONVERGING';
  return 'COUNTERING';
}
