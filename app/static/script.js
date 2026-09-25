const urlParams = new URLSearchParams(window.location.search);

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
let roundHistory = [];
let negotiationStartedAt = null;
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

function saveToAuditTrail(outcome, dealPrice, buyerMax){
  const record = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    startedAt: negotiationStartedAt,
    category: categoryId,
    itemId: itemId,
    itemName: itemName,
    referencePrice: referencePrice,
    sellerMin: sellerMin,
    rounds: roundHistory,
    outcome,
    dealPrice: dealPrice || null,
    buyerMax: buyerMax || null,
  };
  const existing = JSON.parse(localStorage.getItem('parley_audit_trail') || '[]');
  existing.unshift(record);
  if (existing.length > 50) existing.length = 50; // cap stored history
  localStorage.setItem('parley_audit_trail', JSON.stringify(existing));
}

function setStep(name){
  [stepStart, stepNegotiate, stepOutcome].forEach(s => s.removeAttribute('data-active'));
  if (name === 'start') stepStart.setAttribute('data-active', 'true');
  if (name === 'negotiate') stepNegotiate.setAttribute('data-active', 'true');
  if (name === 'outcome') stepOutcome.setAttribute('data-active', 'true');
}

// Business-level stage label for a round — communicates progression
// (ASK -> COUNTER -> CONCESSION -> DEAL/WALK-AWAY/TIMEOUT) without exposing
// any of the agent's internal reasoning.
function deriveStage(round, prevOffer, newOffer, outcome, done){
  if (done){
    if (outcome === 'deal') return { cls: 'deal', label: 'DEAL' };
    if (outcome === 'walk') return { cls: 'walk', label: 'WALK-AWAY' };
    return { cls: 'timeout', label: 'TIMEOUT' };
  }
  if (round <= 1) return { cls: 'counter', label: 'COUNTER' };
  if (prevOffer !== null && newOffer > prevOffer + 0.05) return { cls: 'concession', label: 'CONCESSION' };
  return { cls: 'ask', label: 'HOLDING FIRM' };
}

function addRoundRow(round, askVal, buyerOffer, prevOffer, outcome, done){
  const stage = deriveStage(round, prevOffer, buyerOffer, outcome, done);
  // on a walk-away, Parley made no new offer this round, so a "vs last round" delta isn't meaningful
  const movement = (prevOffer !== null && !(done && outcome === 'walk')) ? buyerOffer - prevOffer : null;
  const movementHtml = movement !== null
    ? `<div class="offer-movement">${movement > 0.05 ? '+' : ''}${movement.toFixed(1)} vs last round</div>`
    : '';
  const row = document.createElement('div');
  row.className = 'round-row hero-round';
  row.innerHTML = `
    <span class="hero-stage-tag ${stage.cls}">${stage.label}</span>
    <div class="round-badge">${round}</div>
    <div class="side seller-side">
      <div class="label">Seller's ask</div>
      <div class="value">${askVal.toFixed(1)}</div>
    </div>
    <div class="arrow">⇌</div>
    <div class="side buyer-side">
      <div class="label">Parley's offer</div>
      <div class="value">${buyerOffer.toFixed(1)}</div>
      ${movementHtml}
    </div>
  `;
  chatThread.appendChild(row);
  chatThread.scrollTop = chatThread.scrollHeight;
}

function addStatusMsg(outcomeClass, html){
  const div = document.createElement('div');
  div.className = `msg status ${outcomeClass}`;
  div.innerHTML = html;
  chatThread.appendChild(div);
  chatThread.scrollTop = chatThread.scrollHeight;
}

function updateProposal(round, sellerAsk, buyerOffer, statusText, statusClass){
  proposalCard.innerHTML = `
    <div class="proposal-row"><span>Round</span><b>${round} / ${maxRounds}</b></div>
    <div class="proposal-row"><span>Seller's ask</span><b>${sellerAsk !== null ? sellerAsk.toFixed(1) : '—'}</b></div>
    <div class="proposal-row"><span>Parley's offer</span><b>${buyerOffer !== null ? buyerOffer.toFixed(1) : '—'}</b></div>
    <div class="proposal-row ${statusClass || ''}"><span>Status</span><b>${statusText}</b></div>
    <div class="proposal-row proposal-row-sub"><span>Seller's floor (this scenario)</span><b>${sellerMin.toFixed(1)}</b></div>
  `;
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
  roundHistory = [];
  negotiationStartedAt = new Date().toISOString();
  maxRounds = data.max_rounds || 10;
  itemId = data.item.id;
  itemName = data.item.name;
  categoryId = data.category_id;
  referencePrice = data.item.reference_price;
  itemQuantity = data.item.quantity;

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
  askInput.value = '';
  askInput.focus();

  setStep('negotiate');
  updateProposal(0, null, null, 'Awaiting the seller\'s first ask');
}

async function sendOffer(){
  const val = parseFloat(askInput.value);
  if (isNaN(val)) return;

  const prevOffer = roundHistory.length ? roundHistory[roundHistory.length - 1].offer : null;

  const res = await fetch('/api/offer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ask: val })
  });
  const data = await res.json();

  if (data.error){
    alert(data.error);
    return;
  }

  addRoundRow(data.round, val, data.buyer_offer, prevOffer, data.outcome, data.done);
  roundHistory.push({ round: data.round, ask: val, offer: data.buyer_offer, at: new Date().toISOString() });

  askInput.value = '';

  if (data.done){
    offerRow.style.display = 'none';
    newBtn.style.display = 'inline-block';
    setStep('outcome');

    let cls, html;
    if (data.outcome === 'deal'){
      cls = 'deal';
      html = `Deal closed at <b>${data.deal_price.toFixed(1)}</b>. Parley's authorized maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else if (data.outcome === 'walk'){
      cls = 'walk';
      html = `Parley walked away from this deal. Its authorized maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else {
      cls = 'timeout';
      html = `Negotiation timed out after ${maxRounds} rounds. Parley's authorized maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    }
    addStatusMsg(cls, html);
    updateProposal(data.round, val, data.buyer_offer, data.outcome.toUpperCase(), cls);
    saveToAuditTrail(data.outcome, data.deal_price, data.buyer_max);
  } else {
    updateProposal(data.round, val, data.buyer_offer, 'Counter-offer');
    askInput.focus();
  }
}

startBtn.addEventListener('click', startNegotiation);
newBtn.addEventListener('click', startNegotiation);
sendBtn.addEventListener('click', sendOffer);
askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOffer(); });

setStep('start');
