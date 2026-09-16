let allCategories = {}, allItems = {};

async function loadCategoryData(){
  const res = await fetch('/api/categories');
  const data = await res.json();
  allCategories = data.categories; allItems = data.items;
  const sel = document.getElementById('cmCategory');
  if (sel){
    sel.innerHTML = Object.entries(allCategories).map(([id,c]) => `<option value="${id}">${c.icon} ${c.name}</option>`).join('');
    sel.addEventListener('change', renderCmQuickfill);
    renderCmQuickfill();
  }
}

let cmQuickfillItems = [];

function renderCmQuickfill(){
  const catId = document.getElementById('cmCategory').value;
  cmQuickfillItems = Object.values(allItems).filter(i => i.category === catId);
  const row = document.getElementById('cmQuickfillRow');
  row.innerHTML = cmQuickfillItems.map((item, idx) =>
    `<button type="button" class="quickfill-chip" data-idx="${idx}">${item.name}</button>`
  ).join('');
  row.querySelectorAll('.quickfill-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const item = cmQuickfillItems[Number(chip.dataset.idx)];
      document.getElementById('cmName').value = item.name;
      document.getElementById('cmRef').value = Math.round((item.min + item.max) / 2);
    });
  });
}

function openCampaignModal(){
  document.getElementById('campaignModal').style.display = 'flex';
  document.getElementById('cmError').style.display = 'none';
}
function closeCampaignModal(){ document.getElementById('campaignModal').style.display = 'none'; }

document.getElementById('newCampaignBtn')?.addEventListener('click', openCampaignModal);
document.getElementById('campaignModalClose')?.addEventListener('click', closeCampaignModal);
document.getElementById('campaignCancel')?.addEventListener('click', closeCampaignModal);
document.getElementById('campaignModal')?.addEventListener('click', (e) => { if (e.target.id === 'campaignModal') closeCampaignModal(); });

document.getElementById('campaignLaunch')?.addEventListener('click', async () => {
  const catId = document.getElementById('cmCategory').value;
  const name = document.getElementById('cmName').value.trim();
  const ref = parseFloat(document.getElementById('cmRef').value);
  const totalCount = parseInt(document.getElementById('cmCount').value, 10);
  const playOne = document.getElementById('cmPlayOne').checked;
  const errEl = document.getElementById('cmError');

  if (!name || isNaN(ref) || ref <= 0 || isNaN(totalCount) || totalCount < 2){
    errEl.textContent = 'Enter an item name, a valid reference price, and at least 2 negotiations.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const item = { name, description: '', details: [], reference_price: ref };
  const autoCount = playOne ? totalCount - 1 : totalCount;

  document.getElementById('campaignLaunch').textContent = 'Running…';
  let autoResults = [];
  if (autoCount > 0){
    const res = await fetch('/api/campaign/simulate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ item, count: autoCount })
    });
    const data = await res.json();
    if (data.error){ errEl.textContent = data.error; errEl.style.display = 'block'; document.getElementById('campaignLaunch').textContent = 'Launch campaign →'; return; }
    autoResults = data.results;
  }
  document.getElementById('campaignLaunch').textContent = 'Launch campaign →';

  const campaignId = Date.now();
  const campaign = {
    id: campaignId, timestamp: new Date().toISOString(), category: catId, itemName: name,
    referencePrice: ref, totalRuns: totalCount, playingHuman: playOne,
    autoResults, humanResult: null, status: playOne ? 'awaiting_human' : 'complete'
  };
  const campaigns = JSON.parse(localStorage.getItem('parley_campaigns') || '[]');
  campaigns.unshift(campaign);
  localStorage.setItem('parley_campaigns', JSON.stringify(campaigns));

  closeCampaignModal();
  if (playOne){
    sessionStorage.setItem('parley_pending_item', JSON.stringify(item));
    window.location.href = `/desk?category=${catId}&custom=1&campaignId=${campaignId}`;
  } else {
    loadCampaigns();
  }
});

function campaignStats(c){
  const all = [...c.autoResults, ...(c.humanResult ? [c.humanResult] : [])];
  const deals = all.filter(r => r.outcome === 'deal');
  const dealRate = all.length ? deals.length / all.length : 0;
  const avgSaving = deals.length ? deals.reduce((s,r)=> s + Math.max(0, r.buyerMax - r.dealPrice), 0) / deals.length : 0;
  const avgRounds = deals.length ? deals.reduce((s,r)=> s + r.rounds.length, 0) / deals.length : 0;
  return { completed: all.length, dealRate, avgSaving, avgRounds };
}

function loadCampaigns(){
  const list = document.getElementById('campaignList');
  if (!list) return;
  const campaigns = JSON.parse(localStorage.getItem('parley_campaigns') || '[]');
  if (campaigns.length === 0){
    list.innerHTML = `<div class="recent-empty">No campaigns yet. Launch one to negotiate several deals at once.</div>`;
    return;
  }
  list.innerHTML = campaigns.map(c => {
    const stats = campaignStats(c);
    const pending = c.status === 'awaiting_human';
    return `<div class="recent-item" data-id="${c.id}">
      <div class="recent-item-main">
        <div class="recent-item-cat">${c.itemName}</div>
        <div class="recent-item-meta">${c.totalRuns} negotiations · ${stats.completed}/${c.totalRuns} done${pending ? ' · your turn' : ''}</div>
      </div>
      <span class="audit-badge ${pending ? 'timeout' : 'deal'}">${Math.round(stats.dealRate*100)}% deal rate</span>
      <span class="recent-item-time">${pending ? '<a class="link-btn" href="/desk?category='+c.category+'&custom=1&campaignId='+c.id+'">Resume →</a>' : timeAgo(c.timestamp)}</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.recent-item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    showCampaignDetail(Number(el.dataset.id));
  }));
}

function renderCampaignRun(r, idx){
  const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${r.dealPrice}` : r.outcome === 'walk' ? 'Walked' : 'Timed out';
  const badgeClass = r.outcome === 'deal' ? 'deal' : r.outcome === 'walk' ? 'walk' : 'timeout';
  const roundsHtml = r.rounds.map(row => `
    <div class="round-row">
      <div class="round-badge">${row.round}</div>
      <div class="side seller-side"><div class="label">Ask</div><div class="value">${row.ask}</div></div>
      <div class="arrow">⇌</div>
      <div class="side buyer-side"><div class="label">Offer</div><div class="value">${row.offer}</div></div>
    </div>
  `).join('');
  return `
    <div class="audit-entry">
      <div class="audit-entry-header">
        <span class="audit-entry-cat">Run ${idx+1} — ${r.who}</span>
        <span class="audit-item-rounds">${r.rounds.length} rounds · buyer max ${r.buyerMax}</span>
        <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
      </div>
      <div class="audit-entry-detail">${roundsHtml}</div>
    </div>
  `;
}

function showCampaignDetail(id){
  const campaigns = JSON.parse(localStorage.getItem('parley_campaigns') || '[]');
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  const stats = campaignStats(c);
  const detail = document.getElementById('campaignDetail');
  detail.style.display = 'block';
  const all = [...c.autoResults.map(r => ({...r, who:'Agent'})), ...(c.humanResult ? [{...c.humanResult, who:'You'}] : [])];
  detail.innerHTML = `
    <h3 style="font-family:var(--heading); margin:0 0 4px;">${c.itemName}</h3>
    <p class="explain">Reference price $${c.referencePrice.toLocaleString()} · ${c.totalRuns} negotiations</p>
    <div class="perf-grid" style="grid-template-columns:repeat(3,1fr); margin-bottom:20px;">
      <div class="perf-card"><div class="perf-label">Deal rate</div><div class="perf-val">${Math.round(stats.dealRate*100)}%</div></div>
      <div class="perf-card"><div class="perf-label">Avg savings/deal</div><div class="perf-val">$${Math.round(stats.avgSaving).toLocaleString()}</div></div>
      <div class="perf-card"><div class="perf-label">Avg rounds to close</div><div class="perf-val">${stats.avgRounds.toFixed(1)}</div></div>
    </div>
    ${all.map((r,i) => renderCampaignRun(r,i)).join('')}
  `;
  detail.querySelectorAll('.audit-entry-header').forEach(header => {
    header.addEventListener('click', () => header.parentElement.classList.toggle('expanded'));
  });
}

document.getElementById('clearCampaignsBtn')?.addEventListener('click', () => {
  if (!confirm('Remove all campaign history? This cannot be undone.')) return;
  localStorage.removeItem('parley_campaigns');
  document.getElementById('campaignDetail').style.display = 'none';
  loadCampaigns();
});

loadCategoryData();
