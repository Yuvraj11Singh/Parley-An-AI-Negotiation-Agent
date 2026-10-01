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

const itemCard = document.getElementById('itemCard');
const icName = document.getElementById('icName');
const icDesc = document.getElementById('icDesc');
const icDetails = document.getElementById('icDetails');
const icRange = document.getElementById('icRange');

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

function fmtUsd(n){
  return '$' + Math.round(n).toLocaleString('en-US');
}

function renderDealBrief(){
  if (!pendingItem || !dealBrief) return;
  dbCategory.textContent = categoryNames[categoryId] || categoryId || '—';
  dbItem.textContent = pendingItem.name || '—';
  dbQty.textContent = pendingItem.quantity ? `${pendingItem.quantity} units` : '—';
  if (pendingItem.reference_price){
    const perUnit = pendingItem.quantity ? ` (≈ ${fmtUsd(pendingItem.reference_price / pendingItem.quantity)}/unit)` : '';
    dbTarget.textContent = `${fmtUsd(pendingItem.reference_price)}${perUnit}`;
  } else {
    dbTarget.textContent = '—';
  }
  dbReqs.innerHTML = (pendingItem.details && pendingItem.details.length)
    ? pendingItem.details.map(d => `<span class="deal-brief-req">${d}</span>`).join('')
    : '';
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

// negotiation-state derivation now lives in negotiation-model.js
// (deriveRoundState) — single source of truth, shared with the audit trail.

// --- round rendering: seller's ask registers first, then a brief "Parley
// is considering" beat, then Parley's offer eases in. Under reduced motion
// this collapses to one instant, fully-populated row. ---------------------

async function addRoundRow(round, askVal, buyerOffer, prevOffer, stage, done, outcome){
  const isWalkDone = done && outcome === 'walk';
  const movement = (prevOffer !== null && !isWalkDone) ? buyerOffer - prevOffer : null;

  const row = document.createElement('div');
  row.className = 'round-row hero-round round-enter';
  row.innerHTML = `
    <span class="hero-stage-tag ${stage.cls}" style="opacity:0;">${stage.label}</span>
    <div class="round-badge">${round}</div>
    <div class="side seller-side">
      <div class="label">Seller's ask</div>
      <div class="value">${askVal.toFixed(1)}</div>
    </div>
    <div class="arrow">⇌</div>
    <div class="side buyer-side">
      <div class="label">Parley's offer</div>
      <div class="value buyer-value"></div>
    </div>
  `;
  chatThread.appendChild(row);
  markCurrentRound(row, null);
  scrollThreadToBottom();

  const buyerValueEl = row.querySelector('.buyer-value');
  const badgeEl = row.querySelector('.hero-stage-tag');

  if (prefersReducedMotion){
    buyerValueEl.textContent = buyerOffer.toFixed(1);
    badgeEl.style.opacity = '1';
    if (movement !== null){
      const m = document.createElement('div');
      m.className = 'offer-movement';
      m.textContent = `${movement > 0.05 ? '+' : ''}${movement.toFixed(1)} vs last round`;
      buyerValueEl.after(m);
    }
    if (done) markCurrentRound(row, outcome);
    return;
  }

  // beat 1: let the seller's ask register
  await sleep(260);

  // beat 2: Parley is considering — a neutral processing cue, not a claim
  // about what it's "thinking"
  buyerValueEl.classList.add('thinking');
  buyerValueEl.innerHTML = '<span class="thinking-dots"><i></i><i></i><i></i></span>';
  await sleep(520);

  // beat 3: Parley's offer eases in
  buyerValueEl.classList.remove('thinking');
  buyerValueEl.textContent = '';
  tweenNumber(buyerValueEl, prevOffer !== null ? prevOffer : buyerOffer, buyerOffer, 420);
  await sleep(420);

  badgeEl.style.opacity = '1';

  if (movement !== null){
    const m = document.createElement('div');
    m.className = 'offer-movement offer-movement-enter';
    m.textContent = `${movement > 0.05 ? '+' : ''}${movement.toFixed(1)} vs last round`;
    buyerValueEl.after(m);
  }

  if (done) markCurrentRound(row, outcome);
  scrollThreadToBottom();
}

// --- outcome: a polished, earned conclusion rather than a status-text swap

function renderOutcome(data, lastAsk){
  const cls = data.outcome; // 'deal' | 'walk' | 'timeout'
  const div = document.createElement('div');
  div.className = `msg status ${cls} outcome-card${prefersReducedMotion ? '' : ' outcome-enter'}`;

  if (cls === 'deal'){
    const savings = Math.max(0, data.buyer_max - data.deal_price);
    div.innerHTML = `
      <div class="outcome-headline">✓ Deal closed at <b>${data.deal_price.toFixed(1)}</b></div>
      <div class="outcome-grid">
        <div><span>Seller's final ask</span><b>${lastAsk.toFixed(1)}</b></div>
        <div><span>Parley's final offer</span><b>${data.buyer_offer.toFixed(1)}</b></div>
        <div><span>Parley's hidden max</span><b>${data.buyer_max.toFixed(1)}</b></div>
        <div><span>Value captured</span><b class="outcome-savings">${savings.toFixed(1)}</b></div>
      </div>
    `;
  } else if (cls === 'walk'){
    div.innerHTML = `
      <div class="outcome-headline">Parley walked away from this negotiation</div>
      <div class="outcome-grid outcome-grid-2">
        <div><span>Seller's final ask</span><b>${lastAsk.toFixed(1)}</b></div>
        <div><span>Parley's hidden max</span><b>${data.buyer_max.toFixed(1)}</b></div>
      </div>
      <div class="outcome-explain">Parley has its own hidden maximum price for this negotiation — generated at random each time you start one. No deal was possible within that limit, so it stopped negotiating.</div>
    `;
  } else {
    div.innerHTML = `
      <div class="outcome-headline">Negotiation timed out after ${maxRounds} rounds</div>
      <div class="outcome-grid outcome-grid-2">
        <div><span>Seller's final ask</span><b>${lastAsk.toFixed(1)}</b></div>
        <div><span>Parley's final offer</span><b>${data.buyer_offer.toFixed(1)}</b></div>
      </div>
      <div class="outcome-explain">No agreement was reached within the round limit. Parley's hidden maximum for this negotiation was ${data.buyer_max.toFixed(1)}.</div>
    `;
  }

  chatThread.appendChild(div);
  scrollThreadToBottom();
}

// --- proposal panel: built once per negotiation, then values are updated
// (and tweened) in place rather than replacing the whole card each round --

function renderProposalSkeleton(){
  proposalCard.innerHTML = `
    <div class="proposal-row"><span>Round</span><b id="pRound">0 / ${maxRounds}</b></div>
    <div class="proposal-row"><span>Seller's ask</span><b id="pSellerAsk">—</b></div>
    <div class="proposal-row"><span>Parley's offer</span><b id="pBuyerOffer">—</b></div>
    <div class="proposal-row" id="pStatusRow"><span>Status</span><b id="pStatusText" class="status-badge-text">Awaiting the seller's first ask</b></div>
    <div class="proposal-row proposal-row-sub"><span>Seller's floor (this scenario)</span><b>${sellerMin.toFixed(1)}</b></div>
  `;
}

let lastProposalSeller = null;
let lastProposalOffer = null;

function updateProposalValues(round, sellerAsk, buyerOffer, statusText, statusClass){
  const pRound = document.getElementById('pRound');
  const pSellerAsk = document.getElementById('pSellerAsk');
  const pBuyerOffer = document.getElementById('pBuyerOffer');
  const pStatusRow = document.getElementById('pStatusRow');
  const pStatusText = document.getElementById('pStatusText');
  if (!pRound) return;

  pRound.textContent = `${round} / ${maxRounds}`;

  if (sellerAsk !== null){
    tweenNumber(pSellerAsk, lastProposalSeller, sellerAsk, 350);
    lastProposalSeller = sellerAsk;
  }
  if (buyerOffer !== null){
    tweenNumber(pBuyerOffer, lastProposalOffer, buyerOffer, 350);
    lastProposalOffer = buyerOffer;
  }

  pStatusRow.className = `proposal-row ${statusClass || ''}`;
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

  negotiationRecord = createNegotiationRecord({
    category: categoryId,
    itemId,
    itemName,
    referencePrice,
    quantity: itemQuantity,
    requirements: data.item.details,
    sellerMin,
  });

  deskSub.textContent = `Negotiating: ${data.item.name} · ${data.category}`;

  icName.textContent = data.item.name;
  icDesc.textContent = data.item.description;
  icDetails.innerHTML = (data.item.details || []).map(d => `<li>${d}</li>`).join('');
  const qtyPart = data.item.quantity ? `Qty ${data.item.quantity} · ` : '';
  const perUnitPart = data.item.quantity ? ` (≈ ${fmtUsd(data.item.reference_price / data.item.quantity)}/unit)` : '';
  icRange.textContent = `${qtyPart}Target price ${fmtUsd(data.item.reference_price)}${perUnitPart}`;
  itemCard.style.display = 'flex';

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

  const stage = deriveRoundState(data.round, prevOffer, data.buyer_offer, data.outcome, data.done);
  await addRoundRow(data.round, val, data.buyer_offer, prevOffer, stage, data.done, data.outcome);
  pushNegotiationRound(negotiationRecord, {
    roundNumber: data.round,
    sellerAsk: val,
    agentOffer: data.buyer_offer,
    prevOffer,
    action: data.action,
    outcome: data.outcome,
    done: data.done,
  });

  if (data.done){
    offerRow.style.display = 'none';
    newBtn.style.display = 'inline-block';
    setStep('outcome');
    updateProposalValues(data.round, val, data.buyer_offer, stage.label, stage.cls);
    await sleep(250);
    renderOutcome(data, val);
    finalizeNegotiationRecord(negotiationRecord, data.outcome, data.deal_price, data.buyer_max);
    saveNegotiationRecord(negotiationRecord);
  } else {
    updateProposalValues(data.round, val, data.buyer_offer, stage.label, stage.cls);
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
