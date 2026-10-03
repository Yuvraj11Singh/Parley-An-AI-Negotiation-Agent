const urlParams = new URLSearchParams(window.location.search);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const chatThread = document.getElementById('chatThread');
const chatEmpty = document.getElementById('chatEmpty');
const startBtn = document.getElementById('startBtn');
const newBtn = document.getElementById('newBtn');
const offerRow = document.getElementById('offerRow');
const askInput = document.getElementById('askInput');
const sendBtn = document.getElementById('sendBtn');
const proposalCard = document.getElementById('proposalCard');
const deskSub = document.getElementById('deskSub');

const dealBrief = document.getElementById('dealBrief');
const dbCategory = document.getElementById('dbCategory');
const dbItem = document.getElementById('dbItem');
const dbQty = document.getElementById('dbQty');
const dbTarget = document.getElementById('dbTarget');
const dbReqs = document.getElementById('dbReqs');
const dbPrefs = document.getElementById('dbPrefs');

const itemCard = document.getElementById('itemCard');
const icName = document.getElementById('icName');
const icCategory = document.getElementById('icCategory');
const icDesc = document.getElementById('icDesc');
const icDetails = document.getElementById('icDetails');
const icRange = document.getElementById('icRange');
const icConcessions = document.getElementById('icConcessions');

const stepStart = document.getElementById('step-start');
const stepNegotiate = document.getElementById('step-negotiate');
const stepOutcome = document.getElementById('step-outcome');

let sellerMin = null;
let negotiationRecord = null;
let maxRounds = 10;
let itemId = urlParams.get('item');
let itemName = null;
let categoryId = urlParams.get('category');
let referencePrice = null;
let itemQuantity = null;
let categoryNames = {};
let openingGap = null;    // set once round 1 resolves — the scale the negotiation-zone bar and phase detector measure against
let lastGap = null;
let openingSellerAsk = null;   // round-1 seller ask — the fixed left end of the Pulse's seller-movement bar
let openingBuyerOffer = null;  // round-1 Parley offer — the fixed left end of the Pulse's position bar
let gapHistory = [];            // trailing gap values shown in the Pulse's "negotiation gap" trail

let pendingItem = null;
if (urlParams.get('custom') === '1'){
  try {
    pendingItem = JSON.parse(sessionStorage.getItem('parley_pending_item') || 'null');
  } catch (e) {
    pendingItem = null;
  }
}

// Category display names, for the pre-negotiation deal brief — same lookup
// pattern used on the dashboard. Read-only, doesn't touch negotiation state.
fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    Object.keys(data.categories || {}).forEach(id => { categoryNames[id] = data.categories[id].name; });
    renderDealBrief();
  })
  .catch(() => {});

function renderDealBrief(){
  if (!pendingItem || !dealBrief) return;
  dbCategory.textContent = categoryNames[categoryId] || categoryId || '—';
  dbItem.textContent = pendingItem.name || '—';
  dbQty.textContent = pendingItem.quantity ? `${pendingItem.quantity} units` : '—';
  if (pendingItem.reference_price){
    const perUnit = pendingItem.quantity ? ` (≈ ${fmtPrice(pendingItem.reference_price / pendingItem.quantity)}/unit)` : '';
    dbTarget.textContent = `${fmtPrice(pendingItem.reference_price)}${perUnit}`;
  } else {
    dbTarget.textContent = '—';
  }
  dbReqs.innerHTML = (pendingItem.details && pendingItem.details.length)
    ? pendingItem.details.map(d => `<span class="deal-brief-req">${d}</span>`).join('')
    : '';
  const hasPrefs = pendingItem.preferences && pendingItem.preferences.length;
  const dbPrefsWrap = document.getElementById('dbPrefsWrap');
  if (dbPrefs && dbPrefsWrap){
    dbPrefs.innerHTML = hasPrefs ? pendingItem.preferences.map(p => `<span class="deal-brief-pref">${p}</span>`).join('') : '';
    dbPrefsWrap.style.display = hasPrefs ? 'block' : 'none';
  }
  dealBrief.style.display = 'block';
}
renderDealBrief();

function setStep(name){
  [stepStart, stepNegotiate, stepOutcome].forEach(s => s.removeAttribute('data-active'));
  if (name === 'start') stepStart.setAttribute('data-active', 'true');
  if (name === 'negotiate') stepNegotiate.setAttribute('data-active', 'true');
  if (name === 'outcome') stepOutcome.setAttribute('data-active', 'true');
}

// --- small animation utilities -------------------------------------------

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, prefersReducedMotion ? 0 : ms));
}

// Eases a number display from one value to another. Falls back to an
// instant set under reduced motion.
function tweenNumber(el, from, to, duration){
  if (prefersReducedMotion || from === null || from === undefined || isNaN(from)){
    el.textContent = to.toFixed(1);
    return;
  }
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (from + (to - from) * eased).toFixed(1);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = to.toFixed(1);
  }
  requestAnimationFrame(frame);
}

function scrollThreadToBottom(){
  if (prefersReducedMotion){
    chatThread.scrollTop = chatThread.scrollHeight;
  } else {
    chatThread.scrollTo({ top: chatThread.scrollHeight, behavior: 'smooth' });
  }
}

// Keeps a subtle ring on whichever round is most recent, removing it from
// the one before — de-emphasizing history in favor of what's current now.
function markCurrentRound(row, outcome){
  const prev = chatThread.querySelector('.round-row.current');
  if (prev && prev !== row) prev.classList.remove('current', 'current-deal', 'current-walk', 'current-timeout');
  row.classList.add('current');
  if (outcome) row.classList.add(`current-${outcome}`);
}

// negotiation-state derivation, concession inventory, position/phase
// detection all live in negotiation-model.js — single source of truth,
// shared with the audit trail.

// --- round rendering: seller's ask registers first, then a brief "Parley
// is considering" beat, then Parley's offer eases in. Under reduced motion
// this collapses to one instant, fully-populated row. ---------------------

// Formats a tweening number as money while it eases from one value to
// another — tweenNumber (negotiation-model.js-adjacent helper above) writes
// a plain toFixed(1) string, so Parley's offer gets its own tween that
// renders through fmtPrice at every frame instead.
function tweenMoney(el, from, to, duration){
  if (prefersReducedMotion || from === null || from === undefined || isNaN(from)){
    el.textContent = fmtPrice(to);
    return;
  }
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtPrice(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = fmtPrice(to);
  }
  requestAnimationFrame(frame);
}

async function addRoundRow(round, askVal, buyerOffer, prevOffer, stage, done, outcome, statementObj){
  const isWalkDone = done && outcome === 'walk';
  const movement = (prevOffer !== null && !isWalkDone) ? buyerOffer - prevOffer : null;
  const parleyTag = statementObj ? statementObj.label : `PARLEY · ${stage.label}`;
  const statementText = statementObj ? statementObj.text : '';

  const row = document.createElement('div');
  row.className = 'round-row hero-round round-enter';
  row.innerHTML = `
    <span class="hero-stage-tag ${stage.cls}" style="opacity:0;">${stage.label}</span>
    <div class="round-badge">${round}</div>
    <div class="round-body">
      <div class="round-seller-line">
        <span class="speaker-tag">YOU</span>
        <span class="round-seller-meta">ROUND ${round}</span>
        <span class="round-seller-value">${fmtPrice(askVal)}</span>
      </div>
      <div class="round-seller-caption">Seller's asking price</div>
      <div class="round-parley-block ${stage.cls}">
        <div class="parley-tag">${parleyTag}</div>
        <div class="parley-statement"></div>
        <div class="parley-offer-value"></div>
      </div>
    </div>
  `;
  chatThread.appendChild(row);
  markCurrentRound(row, null);
  scrollThreadToBottom();

  const statementEl = row.querySelector('.parley-statement');
  const offerEl = row.querySelector('.parley-offer-value');
  const badgeEl = row.querySelector('.hero-stage-tag');

  if (prefersReducedMotion){
    if (statementText) statementEl.textContent = `"${statementText}"`;
    offerEl.textContent = (outcome === 'walk') ? '' : fmtPrice(buyerOffer);
    badgeEl.style.opacity = '1';
    if (movement !== null && outcome !== 'walk'){
      const m = document.createElement('div');
      m.className = 'offer-movement';
      m.textContent = movement > 0.05 ? `+${fmtPrice(movement)} vs last round` : 'No movement';
      offerEl.after(m);
    }
    if (done) markCurrentRound(row, outcome);
    return;
  }

  // beat 1: let the seller's ask register
  await sleep(220);

  // beat 2: "Parley is evaluating…" — a neutral processing cue, not a claim
  // about what it's actually doing internally
  statementEl.innerHTML = '<span class="thinking-dots"><i></i><i></i><i></i></span> Parley is evaluating…';
  statementEl.classList.add('thinking');
  await sleep(380);

  // beat 3: Parley's real tag, statement and offer appear together
  statementEl.classList.remove('thinking');
  statementEl.textContent = statementText ? `"${statementText}"` : '';
  statementEl.classList.add('statement-enter');
  if (outcome === 'walk'){
    offerEl.textContent = '';
  } else {
    tweenMoney(offerEl, prevOffer !== null ? prevOffer : buyerOffer, buyerOffer, 380);
  }
  await sleep(380);

  badgeEl.style.opacity = '1';

  if (movement !== null && outcome !== 'walk'){
    const m = document.createElement('div');
    m.className = 'offer-movement offer-movement-enter';
    m.textContent = movement > 0.05 ? `+${fmtPrice(movement)} vs last round` : 'No movement';
    offerEl.after(m);
  }

  if (done) markCurrentRound(row, outcome);
  scrollThreadToBottom();
}

// --- outcome: a polished, earned conclusion rather than a status-text swap

function fmtDuration(ms){
  if (ms === null || ms === undefined) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function renderOutcome(data, lastAsk){
  const cls = data.outcome; // 'deal' | 'walk' | 'timeout'
  const div = document.createElement('div');
  div.className = `msg status ${cls} outcome-card${prefersReducedMotion ? '' : ' outcome-enter'}`;

  const roundCount = negotiationRecord.rounds.length;
  const duration = fmtDuration(negotiationRecord.startedAt ? (Date.now() - new Date(negotiationRecord.startedAt).getTime()) : null);
  const termsLine = [
    itemQuantity ? `Qty ${itemQuantity}` : null,
    negotiationRecord.requirements && negotiationRecord.requirements.length ? `${negotiationRecord.requirements.length} requirement${negotiationRecord.requirements.length === 1 ? '' : 's'} recorded` : null,
  ].filter(Boolean).join(' · ');

  if (cls === 'deal'){
    const savings = Math.max(0, data.buyer_max - data.deal_price);
    const target = negotiationRecord.targetPrice;
    // Section 12: final > target is not a failure, and final < target is
    // extra value beyond what was expected — say so plainly rather than
    // leaving the user to infer it from a bare number comparison
    let targetLine = '';
    if (target != null){
      const vsTarget = data.deal_price - target;
      targetLine = Math.abs(vsTarget) < 0.01
        ? `<div class="outcome-explain">This closed right at your target price of ${fmtPrice(target)}.</div>`
        : vsTarget > 0
          ? `<div class="outcome-explain">This closed ${fmtPrice(vsTarget)} above your target of ${fmtPrice(target)}, but still ${fmtPrice(savings)} below Parley's reservation price — real value was still captured.</div>`
          : `<div class="outcome-explain">This closed ${fmtPrice(-vsTarget)} below your target of ${fmtPrice(target)} — extra value beyond what you expected.</div>`;
    }
    div.innerHTML = `
      <div class="outcome-headline">✓ Deal closed at <b>${fmtPrice(data.deal_price)}</b></div>
      <div class="outcome-grid">
        <div><span>Seller's final ask</span><b>${fmtPrice(lastAsk)}</b></div>
        <div><span>Parley's final offer</span><b>${fmtPrice(data.buyer_offer)}</b></div>
        <div><span>Target price</span><b>${fmtPrice(target)}</b></div>
        <div><span>Parley's reservation price</span><b>${fmtPrice(data.buyer_max)}</b></div>
        <div><span>Value captured</span><b class="outcome-savings">${fmtPrice(savings)}</b></div>
        <div><span>Rounds</span><b>${roundCount}</b></div>
        <div><span>Duration</span><b>${duration || '—'}</b></div>
      </div>
      ${targetLine}
      ${termsLine ? `<div class="outcome-explain">${termsLine} — carried with this deal, not negotiated by price.</div>` : ''}
    `;
  } else if (cls === 'walk'){
    const isSafeguard = data.walk_reason === 'safeguard' || data.walk_reason === 'seller_stalled';
    let headline, reasonLine;
    if (isSafeguard){
      // a clearly labelled system rule, not a learned behaviour — must read
      // that way, not like the agent made a judgment call. The condition is
      // "neither side moved for N rounds" — mention the hidden maximum ONLY
      // when this round's at_limit genuinely was true; the safeguard can
      // (and does) also fire while Parley is still below its maximum.
      headline = 'Walk-away safeguard';
      reasonLine = data.at_limit
        ? `Parley reached its maximum and neither side moved for ${data.safeguard_hold_rounds} rounds, so no deal was possible.`
        : `Neither side moved for ${data.safeguard_hold_rounds} rounds, so no deal was possible from here.`;
    } else {
      // honest, derived reason: how long the seller's ask had actually moved
      // before Parley stopped — not a fabricated narrative, and never a
      // claim that Parley was out of room (the agent can choose to walk
      // before reaching its limit)
      headline = 'Parley walked away from this negotiation';
      const stalledRounds = computeSellerStallRounds(negotiationRecord.rounds);
      reasonLine = stalledRounds >= 2
        ? `The seller's ask hadn't moved for the last ${stalledRounds} rounds before Parley stopped.`
        : `Parley didn't see a workable agreement from here.`;
    }
    const finalGap = Math.max(0, lastAsk - data.buyer_offer);
    div.innerHTML = `
      <div class="outcome-headline">${headline}</div>
      <div class="outcome-grid outcome-grid-2">
        <div><span>Seller's final ask</span><b>${fmtPrice(lastAsk)}</b></div>
        <div><span>Parley's final offer</span><b>${fmtPrice(data.buyer_offer)}</b></div>
        <div><span>Final gap</span><b>${fmtPrice(finalGap)}</b></div>
        <div><span>Parley's reservation price</span><b>${fmtPrice(data.buyer_max)}</b></div>
        <div><span>Round</span><b>${roundCount} / ${maxRounds}</b></div>
        <div><span>Duration</span><b>${duration || '—'}</b></div>
      </div>
      <div class="outcome-explain">${reasonLine}</div>
    `;
  } else {
    const finalGap = Math.max(0, lastAsk - data.buyer_offer);
    div.innerHTML = `
      <div class="outcome-headline">Negotiation timed out after ${maxRounds} rounds</div>
      <div class="outcome-grid outcome-grid-2">
        <div><span>Last seller ask</span><b>${fmtPrice(lastAsk)}</b></div>
        <div><span>Last Parley offer</span><b>${fmtPrice(data.buyer_offer)}</b></div>
        <div><span>Final gap</span><b>${fmtPrice(finalGap)}</b></div>
        <div><span>Rounds completed</span><b>${roundCount}</b></div>
        <div><span>Duration</span><b>${duration || '—'}</b></div>
      </div>
      <div class="outcome-explain">No agreement was reached within the round limit.</div>
    `;
  }

  chatThread.appendChild(div);
  renderAutopsy(negotiationRecord);
  scrollThreadToBottom();
}

// --- Negotiation Autopsy (Section 6): a structured, data-only summary that
// appears right after the outcome card, built entirely from
// negotiation-intelligence.js's pure functions over the now-finalized
// record — the same functions the Audit Trail / Replay use later, so this
// screen and that one can never disagree about what happened. -------------
function renderAutopsy(record){
  const autopsy = computeAutopsy(record);
  if (!autopsy) return;
  const div = document.createElement('div');
  div.className = `autopsy-wrap${prefersReducedMotion ? '' : ' outcome-enter'}`;
  div.innerHTML = buildAutopsyHtml(autopsy);
  chatThread.appendChild(div);
}

// Observed-data-only reason for a walk-away: how many of the most recent
// rounds the seller's ask failed to move — exactly the kind of structured,
// derivable telemetry Phase 3.3 asks for (no invented narrative).
function computeSellerStallRounds(rounds){
  if (rounds.length < 2) return 0;
  let count = 0;
  for (let i = rounds.length - 1; i > 0; i--){
    if (Math.abs(rounds[i].ask - rounds[i - 1].ask) < Math.max(1, rounds[i].ask * 0.0005)){
      count++;
    } else {
      break;
    }
  }
  return count;
}

// --- Parley Status panel: built once per negotiation, then values are
// updated (and tweened) in place rather than replacing the whole card
// each round. Agent-oriented hierarchy per Phase 3.1. ----------------------

function renderProposalSkeleton(){
  proposalCard.innerHTML = `
    <div class="parley-status-head">
      <div class="parley-status-label">Parley status</div>
      <div class="parley-status-state" id="pState">Negotiating</div>
      <span class="phase-pill" id="pPhase">OPENING</span>
    </div>
    <div class="agent-activity" id="pActivity">Awaiting the seller's first ask.</div>

    <div class="negotiation-zone" id="pZone">
      <div class="negotiation-zone-track">
        <div class="negotiation-zone-fill" id="pZoneFill"></div>
        <div class="negotiation-zone-marker buyer" id="pZoneBuyer" title="Parley's offer"></div>
        <div class="negotiation-zone-marker seller" id="pZoneSeller" title="Seller's ask"></div>
      </div>
      <div class="negotiation-zone-labels"><span>Seller's floor</span><span>Opening ask</span></div>
    </div>

    <div class="proposal-row"><span>Round</span><b id="pRound">0 / ${maxRounds}</b></div>
    <div class="proposal-row"><span>Seller's ask</span><b id="pSellerAsk">—</b></div>
    <div class="proposal-row"><span>Current position</span><b id="pBuyerOffer">—</b></div>
    <div class="proposal-row"><span>Movement</span><b id="pMovement">—</b></div>
    <div class="proposal-row" id="pStatusRow"><span>Current action</span><b id="pStatusText" class="status-badge-text">—</b></div>
    <div class="proposal-row"><span>Negotiation position</span><b id="pPosition">—</b></div>
    <div class="proposal-row proposal-row-sub"><span>Seller's floor (this scenario)</span><b>${fmtPrice(sellerMin)}</b></div>
  `;
}

let lastProposalSeller = null;
let lastProposalOffer = null;

function agentActivitySentence(stageLabel, done, outcome){
  if (done){
    if (outcome === 'deal') return 'Parley accepted the deal.';
    if (outcome === 'walk') return 'Parley walked away.';
    return 'Parley ran out of rounds without a deal.';
  }
  if (stageLabel === 'COUNTER') return 'Parley is evaluating the latest ask…';
  if (stageLabel === 'CONCESSION') return 'Parley made a concession.';
  if (stageLabel === 'HOLDING FIRM') return 'Parley is holding firm.';
  if (stageLabel === 'AT LIMIT') return 'Parley is at its maximum.';
  return 'Parley responded.';
}

function updateNegotiationZone(sellerAsk, buyerOffer){
  const zoneSeller = document.getElementById('pZoneSeller');
  const zoneBuyer = document.getElementById('pZoneBuyer');
  const zoneFill = document.getElementById('pZoneFill');
  if (!zoneSeller || openingGap === null) return;
  // fixed scale established at round 1: [sellerMin, opening seller ask] —
  // both fully observable, never Parley's hidden max
  const lo = sellerMin;
  const hi = Math.max(sellerMin + 1, lastProposalSeller !== null ? Math.max(sellerAsk, lo + openingGap) : sellerAsk);
  const span = Math.max(1e-6, hi - lo);
  const pct = (v) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  zoneSeller.style.left = pct(sellerAsk) + '%';
  zoneBuyer.style.left = pct(buyerOffer) + '%';
  const left = Math.min(pct(sellerAsk), pct(buyerOffer));
  const right = Math.max(pct(sellerAsk), pct(buyerOffer));
  zoneFill.style.left = left + '%';
  zoneFill.style.width = Math.max(0, right - left) + '%';
}

const PULSE_PHASES = ['OPENING', 'COUNTERING', 'CONVERGING', 'CLOSING'];
const negotiationPulseEl = document.getElementById('negotiationPulse');

// Answers "where are we in this negotiation right now?" from values already
// on screen elsewhere — derivePhase() for the stage, and each side's own
// movement relative to its round-1 starting point for the two bars. Never
// plots buyer_max (same rule as the existing negotiation-zone bar).
function updatePulse(phase, sellerAsk, buyerOffer, gapNow){
  if (!negotiationPulseEl) return;
  negotiationPulseEl.style.display = 'block';

  const phaseIdx = PULSE_PHASES.indexOf(phase);
  document.querySelectorAll('#pulsePhases .pulse-phase').forEach((el, i) => {
    el.classList.toggle('active', i === phaseIdx);
    el.classList.toggle('done', i < phaseIdx);
  });

  const span = Math.max(1e-6, openingGap || 1);
  const sellerProgress = openingSellerAsk !== null ? Math.min(100, Math.max(0, ((openingSellerAsk - sellerAsk) / span) * 100)) : 0;
  const buyerProgress = openingBuyerOffer !== null ? Math.min(100, Math.max(0, ((buyerOffer - openingBuyerOffer) / span) * 100)) : 0;

  const sellerFill = document.getElementById('pulseSellerFill');
  const buyerFill = document.getElementById('pulseBuyerFill');
  if (sellerFill) sellerFill.style.width = sellerProgress + '%';
  if (buyerFill) buyerFill.style.width = buyerProgress + '%';

  const sellerStartEl = document.getElementById('pulseSellerStart');
  const sellerNowEl = document.getElementById('pulseSellerNow');
  const buyerStartEl = document.getElementById('pulseBuyerStart');
  const buyerNowEl = document.getElementById('pulseBuyerNow');
  if (sellerStartEl) sellerStartEl.textContent = fmtPrice(openingSellerAsk);
  if (sellerNowEl) sellerNowEl.textContent = fmtPrice(sellerAsk);
  if (buyerStartEl) buyerStartEl.textContent = fmtPrice(openingBuyerOffer);
  if (buyerNowEl) buyerNowEl.textContent = fmtPrice(buyerOffer);

  const trailEl = document.getElementById('pulseGapTrail');
  if (trailEl){
    const recent = gapHistory.slice(-4);
    trailEl.textContent = recent.map(g => fmtPrice(g)).join('  →  ');
  }
}

function updateProposalValues(round, sellerAsk, buyerOffer, statusText, statusClass, done, outcome){
  const pRound = document.getElementById('pRound');
  const pSellerAsk = document.getElementById('pSellerAsk');
  const pBuyerOffer = document.getElementById('pBuyerOffer');
  const pMovement = document.getElementById('pMovement');
  const pStatusRow = document.getElementById('pStatusRow');
  const pStatusText = document.getElementById('pStatusText');
  const pPosition = document.getElementById('pPosition');
  const pPhase = document.getElementById('pPhase');
  const pState = document.getElementById('pState');
  const pActivity = document.getElementById('pActivity');
  if (!pRound) return;

  pRound.textContent = `${round} / ${maxRounds}`;

  const movement = (lastProposalOffer !== null && buyerOffer !== null) ? buyerOffer - lastProposalOffer : null;
  if (pMovement) pMovement.textContent = movement !== null ? (movement > 0.05 ? `+${fmtPrice(movement)}` : 'No movement') : '—';

  if (sellerAsk !== null){
    tweenMoney(pSellerAsk, lastProposalSeller, sellerAsk, 350);
  }
  if (buyerOffer !== null){
    tweenMoney(pBuyerOffer, lastProposalOffer, buyerOffer, 350);
  }

  const gapNow = (sellerAsk !== null && buyerOffer !== null) ? Math.max(0, sellerAsk - buyerOffer) : null;
  let phase = null;
  if (gapNow !== null){
    if (openingGap === null) openingGap = gapNow;
    if (openingSellerAsk === null) openingSellerAsk = sellerAsk;
    if (openingBuyerOffer === null) openingBuyerOffer = buyerOffer;
    phase = derivePhase(round, maxRounds, gapNow, openingGap);
    if (pPosition) pPosition.textContent = derivePosition(gapNow, lastGap);
    if (pPhase) pPhase.textContent = phase;
    updateNegotiationZone(sellerAsk, buyerOffer);
    gapHistory.push(gapNow);
    updatePulse(phase, sellerAsk, buyerOffer, gapNow);
    lastGap = gapNow;
  }

  lastProposalSeller = sellerAsk !== null ? sellerAsk : lastProposalSeller;
  lastProposalOffer = buyerOffer !== null ? buyerOffer : lastProposalOffer;

  pStatusRow.className = `proposal-row ${statusClass || ''}`;
  if (pState){
    pState.textContent = done ? (outcome === 'deal' ? 'Deal reached' : outcome === 'walk' ? 'Walked away' : 'Timed out') : 'Negotiating';
    pState.className = `parley-status-state${done ? ' ' + outcome : ''}`;
  }
  if (pActivity) pActivity.textContent = agentActivitySentence(statusText, done, outcome);

  if (prefersReducedMotion){
    pStatusText.textContent = statusText;
  } else {
    pStatusText.classList.add('swapping');
    setTimeout(() => {
      pStatusText.textContent = statusText;
      pStatusText.classList.remove('swapping');
    }, 160);
  }
}

async function startNegotiation(){
  const res = await fetch('/api/new_negotiation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: categoryId, item: pendingItem || itemId })
  });
  const data = await res.json();

  if (data.error){
    alert(data.error);
    return;
  }

  const preferences = pendingItem ? pendingItem.preferences : null;

  // the pending custom-item payload is only meant to be used once
  sessionStorage.removeItem('parley_pending_item');
  pendingItem = null;

  sellerMin = data.seller_min;
  maxRounds = data.max_rounds || 10;
  itemId = data.item.id;
  itemName = data.item.name;
  categoryId = data.category_id;
  referencePrice = data.item.reference_price;
  itemQuantity = data.item.quantity;
  lastProposalSeller = null;
  lastProposalOffer = null;
  openingGap = null;
  lastGap = null;
  openingSellerAsk = null;
  openingBuyerOffer = null;
  gapHistory = [];

  negotiationRecord = createNegotiationRecord({
    category: categoryId,
    itemId,
    itemName,
    referencePrice,
    quantity: itemQuantity,
    requirements: data.item.details,
    preferences,
    sellerMin,
    maxRounds,
  });

  deskSub.textContent = `Negotiating: ${data.item.name} · ${data.category}`;

  icName.textContent = data.item.name;
  if (icCategory) icCategory.textContent = data.category || '';
  icDesc.textContent = data.item.description;
  const detailItems = data.item.quantity ? [`Qty ${data.item.quantity}`, ...(data.item.details || [])] : (data.item.details || []);
  icDetails.innerHTML = detailItems.map(d => `<li>${d}</li>`).join('');
  const perUnitPart = data.item.quantity ? ` (≈ ${fmtPrice(data.item.reference_price / data.item.quantity)}/unit)` : '';
  icRange.textContent = `Target price ${fmtPrice(data.item.reference_price)}${perUnitPart}`;
  if (icConcessions){
    const inv = negotiationRecord.concessionInventory;
    icConcessions.innerHTML = `
      <div class="concession-row"><span>Negotiable</span>${inv.negotiable.map(t => `<span class="concession-chip negotiable">${t}</span>`).join('')}</div>
      <div class="concession-row"><span>Protected</span>${inv.protected.length ? inv.protected.map(t => `<span class="concession-chip protected">${t}</span>`).join('') : '<span class="concession-chip protected">None recorded</span>'}</div>
    `;
  }
  itemCard.style.display = 'block';

  dealBrief.style.display = 'none';
  chatThread.innerHTML = '';
  chatEmpty.style.display = 'none';
  startBtn.style.display = 'none';
  newBtn.style.display = 'none';
  offerRow.style.display = 'flex';
  askInput.disabled = false;
  sendBtn.disabled = false;
  askInput.value = '';
  askInput.focus();

  setStep('negotiate');
  renderProposalSkeleton();
}

async function sendOffer(){
  const val = parseFloat(askInput.value);
  if (isNaN(val)) return;

  const prevOffer = negotiationRecord.rounds.length ? negotiationRecord.rounds[negotiationRecord.rounds.length - 1].offer : null;
  const prevSellerAsk = negotiationRecord.rounds.length ? negotiationRecord.rounds[negotiationRecord.rounds.length - 1].ask : null;

  askInput.disabled = true;
  sendBtn.disabled = true;

  const res = await fetch('/api/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ask: val })
  });
  const data = await res.json();

  if (data.error){
    alert(data.error);
    askInput.disabled = false;
    sendBtn.disabled = false;
    return;
  }

  askInput.value = '';

  const stage = deriveRoundState(data.round, prevOffer, data.buyer_offer, data.outcome, data.done, data.at_limit);

  // seeded here (not only in updateProposalValues, called later) because
  // the statement builder needs the phase before the round row renders
  const gapNow = Math.max(0, val - data.buyer_offer);
  if (openingGap === null) openingGap = gapNow;
  if (openingSellerAsk === null) openingSellerAsk = val;
  if (openingBuyerOffer === null) openingBuyerOffer = data.buyer_offer;
  const phase = derivePhase(data.round, maxRounds, gapNow, openingGap);

  const statementObj = buildParleyStatement({
    stage, round: data.round, offer: data.buyer_offer, sellerAsk: val, prevSellerAsk,
    atLimit: data.at_limit, walkReason: data.walk_reason, dealPrice: data.deal_price, phase,
  });

  await addRoundRow(data.round, val, data.buyer_offer, prevOffer, stage, data.done, data.outcome, statementObj);
  pushNegotiationRound(negotiationRecord, {
    roundNumber: data.round,
    sellerAsk: val,
    agentOffer: data.buyer_offer,
    prevOffer,
    action: data.action,
    outcome: data.outcome,
    done: data.done,
    atLimit: data.at_limit,
    walkReason: data.walk_reason,
    statement: statementObj ? statementObj.text : null,
    statementLabel: statementObj ? statementObj.label : null,
  });

  if (data.done){
    offerRow.style.display = 'none';
    newBtn.style.display = 'inline-block';
    setStep('outcome');
    updateProposalValues(data.round, val, data.buyer_offer, stage.label, stage.cls, true, data.outcome);
    await sleep(250);
    // finalize before rendering — the outcome autopsy reads buyerMax/dealPrice/
    // valueCaptured off negotiationRecord, which only this call populates
    finalizeNegotiationRecord(negotiationRecord, data.outcome, data.deal_price, data.buyer_max, data.walk_reason, data.safeguard_hold_rounds);
    renderOutcome(data, val);
    saveNegotiationRecord(negotiationRecord);
  } else {
    updateProposalValues(data.round, val, data.buyer_offer, stage.label, stage.cls, false, null);
    askInput.disabled = false;
    sendBtn.disabled = false;
    askInput.focus();
  }
}

startBtn.addEventListener('click', startNegotiation);
newBtn.addEventListener('click', startNegotiation);
sendBtn.addEventListener('click', sendOffer);
askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOffer(); });

setStep('start');
