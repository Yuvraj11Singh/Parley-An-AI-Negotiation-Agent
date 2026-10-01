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

function createNegotiationRecord({ category, itemId, itemName, referencePrice, quantity, requirements, sellerMin }){
  const now = new Date().toISOString();
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
    requirements: (requirements && requirements.length) ? requirements : null,
    constraints: null,   // not yet collected by the setup flow (Phase 1, later checkpoint)
    preferences: null,   // not yet collected by the setup flow
    priorities: null,    // not yet collected by the setup flow
    seller: null,        // no seller-identity concept exists yet
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
    constraints: raw.constraints ?? null,
    preferences: raw.preferences ?? null,
    priorities: raw.priorities ?? null,
    seller: raw.seller ?? null,
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

function loadAuditTrail(){
  let existing;
  try {
    existing = JSON.parse(localStorage.getItem(AUDIT_TRAIL_KEY) || '[]');
  } catch (e) {
    existing = [];
  }
  return existing.map(normalizeNegotiationRecord);
}

function saveNegotiationRecord(record){
  const existing = loadAuditTrail();
  existing.unshift(record);
  if (existing.length > AUDIT_TRAIL_CAP) existing.length = AUDIT_TRAIL_CAP; // cap stored history
  localStorage.setItem(AUDIT_TRAIL_KEY, JSON.stringify(existing));
}
