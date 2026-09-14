const urlParams = new URLSearchParams(window.location.search);
const categoryId = urlParams.get('category') || 'electronics';

const chatThread = document.getElementById('chatThread');
const chatEmpty = document.getElementById('chatEmpty');
const startBtn = document.getElementById('startBtn');
const newBtn = document.getElementById('newBtn');
const offerRow = document.getElementById('offerRow');
const askInput = document.getElementById('askInput');
const sendBtn = document.getElementById('sendBtn');
const proposalCard = document.getElementById('proposalCard');

const stepStart = document.getElementById('step-start');
const stepNegotiate = document.getElementById('step-negotiate');
const stepOutcome = document.getElementById('step-outcome');

let sellerMin = null;
let roundHistory = [];
let negotiationStartedAt = null;

function saveToAuditTrail(outcome, dealPrice, buyerMax){
  const record = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    startedAt: negotiationStartedAt,
    category: categoryId,
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

function addRoundRow(round, askVal, buyerOffer){
  const row = document.createElement('div');
  row.className = 'round-row';
  row.innerHTML = `
    <div class="round-badge">${round}</div>
    <div class="side seller-side">
      <div class="label">Your ask</div>
      <div class="value">${askVal.toFixed(1)}</div>
    </div>
    <div class="arrow">⇌</div>
    <div class="side buyer-side">
      <div class="label">Buyer offer</div>
      <div class="value">${buyerOffer.toFixed(1)}</div>
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
    <div class="proposal-row"><span>Your minimum</span><b>${sellerMin.toFixed(1)}</b></div>
    <div class="proposal-row"><span>Round</span><b>${round} / 10</b></div>
    <div class="proposal-row"><span>Your ask</span><b>${sellerAsk !== null ? sellerAsk.toFixed(1) : '—'}</b></div>
    <div class="proposal-row"><span>Buyer offer</span><b>${buyerOffer !== null ? buyerOffer.toFixed(1) : '—'}</b></div>
    <div class="proposal-row ${statusClass || ''}"><span>Status</span><b>${statusText}</b></div>
  `;
}

async function startNegotiation(){
  const res = await fetch('/api/new_negotiation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: categoryId })
  });
  const data = await res.json();
  sellerMin = data.seller_min;
  roundHistory = [];
  negotiationStartedAt = new Date().toISOString();

  document.querySelector('.desk-header h1').textContent = `Deal Desk — ${data.category}`;

  chatThread.innerHTML = '';
  chatEmpty.style.display = 'none';
  startBtn.style.display = 'none';
  newBtn.style.display = 'none';
  offerRow.style.display = 'flex';
  askInput.value = '';
  askInput.focus();

  setStep('negotiate');
  updateProposal(0, null, null, 'Awaiting your first offer');
}

async function sendOffer(){
  const val = parseFloat(askInput.value);
  if (isNaN(val)) return;

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

  addRoundRow(data.round, val, data.buyer_offer);
  roundHistory.push({ round: data.round, ask: val, offer: data.buyer_offer, at: new Date().toISOString() });

  askInput.value = '';

  if (data.done){
    offerRow.style.display = 'none';
    newBtn.style.display = 'inline-block';
    setStep('outcome');

    let cls, html;
    if (data.outcome === 'deal'){
      cls = 'deal';
      html = `Deal closed at <b>${data.deal_price.toFixed(1)}</b>. Buyer's hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else if (data.outcome === 'walk'){
      cls = 'walk';
      html = `The buyer walked away. Its hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else {
      cls = 'timeout';
      html = `Negotiation timed out after 10 rounds. Buyer's hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    }
    addStatusMsg(cls, html);
    updateProposal(data.round, val, data.buyer_offer, data.outcome.toUpperCase(), cls);
    saveToAuditTrail(data.outcome, data.deal_price, data.buyer_max);
  } else {
    updateProposal(data.round, val, data.buyer_offer, 'In progress');
    askInput.focus();
  }
}

startBtn.addEventListener('click', startNegotiation);
newBtn.addEventListener('click', startNegotiation);
sendBtn.addEventListener('click', sendOffer);
askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOffer(); });

setStep('start');
