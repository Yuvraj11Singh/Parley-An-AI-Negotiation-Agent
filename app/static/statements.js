// statements.js — a small, deterministic negotiation language system.
//
// Turns the existing round state (deriveRoundState, from negotiation-model.js)
// plus the raw /api/offer response into a short contextual statement for
// Parley. Never calls an LLM, never adds a backend endpoint, never invents
// information the state doesn't contain. Price-only: statements must never
// claim Parley is reasoning about delivery, warranty, quantity or any other
// term — those are shown in the Deal Context panel, not talked about.
//
// Determinism: the variant within a template set is picked from the round
// number (pick()), never Math.random() — the same negotiation always
// produces the same wording. The caller is responsible for saving the
// returned text on the round (see pushNegotiationRound in
// negotiation-model.js) so the Audit Trail can replay the same words
// instead of regenerating them.

// Named thresholds for how a round's seller movement is described —
// fractions of the seller's own previous ask, so they scale with the deal's
// price range instead of being tied to one price level.
const SELLER_MOVEMENT_SIGNIFICANT_FRACTION = 0.03;  // ask dropped by >=3% of its previous value: "significant"
const SELLER_MOVEMENT_BARELY_FRACTION = 0.005;      // ask moved by <0.5% of its previous value: "barely moved"

function classifySellerMovement(sellerAsk, prevSellerAsk){
  if (prevSellerAsk === null || prevSellerAsk === undefined || !isFinite(prevSellerAsk) || prevSellerAsk === 0) return 'unknown';
  const drop = prevSellerAsk - sellerAsk;
  const frac = Math.abs(drop) / Math.abs(prevSellerAsk);
  if (frac < SELLER_MOVEMENT_BARELY_FRACTION) return 'barely';
  if (drop > 0 && frac >= SELLER_MOVEMENT_SIGNIFICANT_FRACTION) return 'significant';
  return 'normal';
}

const STATEMENT_TEMPLATES = {
  opening: [
    "Thanks for sharing your price. I'll open at {offer}.",
    "Let's get started — my opening position is {offer}.",
    "I hear {sellerAsk}. I'll start this at {offer}.",
  ],
  concession: [
    "I can make some room here. I'll move to {offer}.",
    "I can improve the offer to {offer}.",
    "I'll come up to {offer}.",
  ],
  concessionSignificant: [
    "That's a meaningful move on your side — I can respond with {offer}.",
    "I appreciate the movement. I'll meet you with {offer}.",
  ],
  concessionConverging: [
    "We're getting closer to a workable range. I can move to {offer}.",
    "We're narrowing the gap — I'll adjust to {offer}.",
  ],
  hold: [
    "I'm going to maintain my current position at {offer}.",
    "I'll keep my offer at {offer} for now.",
    "I'll stay at {offer} this round.",
  ],
  holdBarely: [
    "We're seeing limited movement on your side. I'll hold my position at {offer} for now.",
    "Since there's been little change from you, I'll stay at {offer}.",
  ],
  atLimit: [
    "{offer} is the most I can offer on this deal.",
    "I've gone as far as I can — {offer} is my position.",
    "{offer} is my final number here.",
  ],
  deal: [
    "That works for us. I'm prepared to close at {dealPrice}.",
    "Agreed — we have a deal at {dealPrice}.",
    "Let's finalize this at {dealPrice}.",
  ],
  walkSafeguardAtLimit: [
    "I've reached the most I can offer, and your price hasn't moved for several rounds. I'll step away.",
    "I'm at my limit, and we've both been at a standstill for a while — I'll step away from this one.",
  ],
  walkSafeguardBelowLimit: [
    "Neither of us has moved for several rounds, so I'll step away from this negotiation.",
    "We've both been at a standstill for a while now — I'll step away.",
  ],
  walkAgent: [
    "I don't see a workable agreement from here, so I'll step away.",
    "This doesn't look like it's heading toward a deal — I'll step away.",
  ],
};

function pickTemplate(templates, seed){
  const idx = ((seed % templates.length) + templates.length) % templates.length;
  return templates[idx];
}

function fillTemplate(text, values){
  return text.replace(/\{(\w+)\}/g, (_, key) => (values[key] !== undefined ? values[key] : ''));
}

/**
 * Builds Parley's contextual statement for one round.
 *
 * @param stage        {cls, label} from deriveRoundState — the single source
 *                      of truth for which state this round is in.
 * @param round         current round number (used only as the deterministic
 *                      variant seed, never for randomness)
 * @param offer         Parley's offer this round
 * @param sellerAsk     seller's ask this round
 * @param prevSellerAsk seller's ask the previous round (null on round 1)
 * @param atLimit       boolean, this round's at_limit from the API
 * @param walkReason    "agent" | "safeguard" | "seller_stalled" | null
 * @param dealPrice     final deal price, only meaningful when stage is DEAL
 * @param phase         OPENING | COUNTERING | CONVERGING | CLOSING (derivePhase)
 * @returns {label, text} or null (no statement for this state, e.g. TIMEOUT —
 *          the round's own action already got a statement; TIMEOUT is an
 *          outcome overlay, not a per-round statement of its own)
 */
function buildParleyStatement({ stage, round, offer, sellerAsk, prevSellerAsk, atLimit, walkReason, dealPrice, phase }){
  const label = stage.label;
  const movement = classifySellerMovement(sellerAsk, prevSellerAsk);
  const values = { offer: fmtPrice(offer), sellerAsk: fmtPrice(sellerAsk), dealPrice: fmtPrice(dealPrice) };

  if (label === 'DEAL'){
    return { label: 'PARLEY · DEAL', text: fillTemplate(pickTemplate(STATEMENT_TEMPLATES.deal, round), values) };
  }
  if (label === 'WALK-AWAY'){
    if (walkReason === 'agent'){
      return { label: 'PARLEY · WALK (agent)', text: pickTemplate(STATEMENT_TEMPLATES.walkAgent, round) };
    }
    // "safeguard" or "seller_stalled" (Rule B — off by default, but handled
    // the same way if the backend ever returns it): the condition is
    // "neither side moved for N rounds", not "Parley is out of room" — only
    // mention the limit when this round's at_limit genuinely was true
    const set = atLimit ? STATEMENT_TEMPLATES.walkSafeguardAtLimit : STATEMENT_TEMPLATES.walkSafeguardBelowLimit;
    return { label: 'PARLEY · WALK (safeguard)', text: pickTemplate(set, round) };
  }
  if (label === 'TIMEOUT'){
    return null;
  }
  if (label === 'COUNTER'){
    return { label: 'PARLEY · OPENING', text: fillTemplate(pickTemplate(STATEMENT_TEMPLATES.opening, round), values) };
  }
  if (label === 'AT LIMIT'){
    return { label: 'PARLEY · AT LIMIT', text: fillTemplate(pickTemplate(STATEMENT_TEMPLATES.atLimit, round), values) };
  }
  if (label === 'HOLDING FIRM'){
    const set = movement === 'barely' ? STATEMENT_TEMPLATES.holdBarely : STATEMENT_TEMPLATES.hold;
    return { label: 'PARLEY · HOLDING FIRM', text: fillTemplate(pickTemplate(set, round), values) };
  }
  if (label === 'CONCESSION'){
    let set = STATEMENT_TEMPLATES.concession;
    if (movement === 'significant') set = STATEMENT_TEMPLATES.concessionSignificant;
    else if (phase === 'CONVERGING' || phase === 'CLOSING') set = STATEMENT_TEMPLATES.concessionConverging;
    return { label: 'PARLEY · CONCESSION', text: fillTemplate(pickTemplate(set, round), values) };
  }
  return null;
}
