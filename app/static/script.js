const preStart = document.getElementById('preStart');
const activeArea = document.getElementById('activeArea');
const sellerMinEl = document.getElementById('sellerMin');
const roundLabel = document.getElementById('roundLabel');
const logBody = document.getElementById('logBody');
const askInput = document.getElementById('askInput');
const offerRow = document.getElementById('offerRow');
const outcomeBox = document.getElementById('outcomeBox');
const newBtn = document.getElementById('newBtn');

let sellerMin = null;

async function startNegotiation(){
  const res = await fetch('/api/new_negotiation', { method: 'POST' });
  const data = await res.json();
  sellerMin = data.seller_min;

  preStart.style.display = 'none';
  activeArea.style.display = 'block';
  sellerMinEl.textContent = sellerMin.toFixed(1);
  roundLabel.textContent = `0 / 10`;
  logBody.innerHTML = '';
  offerRow.style.display = 'flex';
  outcomeBox.style.display = 'none';
  newBtn.style.display = 'none';
  askInput.value = '';
  askInput.focus();
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

  roundLabel.textContent = `${data.round} / 10`;

  const row = document.createElement('tr');
  let status = '—';
  if (data.done){
    if (data.outcome === 'deal') status = `deal closed @ ${data.deal_price.toFixed(1)}`;
    else if (data.outcome === 'walk') status = 'buyer walked away';
    else if (data.outcome === 'timeout') status = 'timed out';
  }
  row.innerHTML = `<td>${data.round}</td><td>${val.toFixed(1)}</td><td>${data.buyer_offer.toFixed(1)}</td><td>${status}</td>`;
  logBody.appendChild(row);

  askInput.value = '';

  if (data.done){
    offerRow.style.display = 'none';
    outcomeBox.style.display = 'block';
    newBtn.style.display = 'inline-block';

    let msgClass = data.outcome === 'deal' ? 'deal' : data.outcome === 'walk' ? 'walk' : 'timeout';
    let msg = '';
    if (data.outcome === 'deal'){
      msg = `Deal closed at <b>${data.deal_price.toFixed(1)}</b>. The buyer's hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else if (data.outcome === 'walk'){
      msg = `The buyer walked away. Its hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    } else {
      msg = `Negotiation timed out after 10 rounds. The buyer's hidden maximum was <b>${data.buyer_max.toFixed(1)}</b>.`;
    }
    outcomeBox.className = `human-status ${msgClass}`;
    outcomeBox.innerHTML = msg;
  } else {
    askInput.focus();
  }
}

document.getElementById('startBtn').addEventListener('click', startNegotiation);
document.getElementById('sendBtn').addEventListener('click', sendOffer);
askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOffer(); });
newBtn.addEventListener('click', startNegotiation);
