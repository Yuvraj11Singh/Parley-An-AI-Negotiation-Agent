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

// --- round-level state derivation (business-level only) --------------------
// Unchanged behavior from the existing Deal Desk — relocated here so it's
// computed in exactly one place as more parts of the app come to need it.
function deriveRoundState(roundNumber, prevOffer, newOffer, outcome, done){
  if (done){
    if (outcome === 'deal') return { cls: 'deal', label: 'DEAL' };
    if (outcome === 'walk') return { cls: 'walk', label: 'WALK-AWAY' };
    return { cls: 'timeout', label: 'TIMEOUT' };
  }
  if (roundNumber <= 1) return { cls: 'counter', label: 'COUNTER' };
  if (prevOffer !== null && newOffer > prevOffer + 0.05) return { cls: 'concession', label: 'CONCESSION' };
  return { cls: 'ask', label: 'HOLDING FIRM' };
}

// --- per-round telemetry (Section 4.4) --------------------------------------
// Everything Section 4.4 asks for, computed once per round.
function buildRoundTelemetry({ roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done }){
  const state = deriveRoundState(roundNumber, prevOffer, agentOffer, outcome, done);
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
  };
}

// --- canonical negotiation record (Section 12) ------------------------------

function createNegotiationRecord({ category, itemId, itemName, referencePrice, quantity, requirements, preferences, sellerMin }){
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
    telemetry: [],
    finalPrice: null,
    valueCaptured: null,
    analytics: {},
  };
}

function pushNegotiationRound(record, { roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done }){
  // v1 shape, exactly as before
  record.rounds.push({ round: roundNumber, ask: sellerAsk, offer: agentOffer, at: new Date().toISOString() });
  // v2 telemetry, additive
  record.telemetry.push(buildRoundTelemetry({ roundNumber, sellerAsk, agentOffer, prevOffer, action, outcome, done }));
}

function finalizeNegotiationRecord(record, outcome, dealPrice, buyerMax){
  record.outcome = outcome;
  record.dealPrice = dealPrice || null;
  record.buyerMax = buyerMax || null;

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
    });
  });
  return {
    ...raw,
    schemaVersion: NEGOTIATION_SCHEMA_VERSION,
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

function derivePhase(round, maxRounds, gapNow, openingGap){
  if (round <= 1) return 'OPENING';
  const roundFrac = round / Math.max(1, maxRounds);
  const gapFrac = openingGap > 0 ? Math.max(0, gapNow) / openingGap : 0;
  if (gapFrac <= 0.05 || roundFrac >= 0.85) return 'CLOSING';
  if (gapFrac <= 0.35) return 'CONVERGENCE';
  return 'EXPLORATION';
}
