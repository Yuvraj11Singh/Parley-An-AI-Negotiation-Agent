const navItems = document.querySelectorAll('.dash-nav-item');
const views = document.querySelectorAll('.dash-view');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const target = item.dataset.view;
    views.forEach(v => {
      v.style.display = (v.id === `view-${target}`) ? 'block' : 'none';
    });
  });
});

const CATEGORY_DISPLAY_NAMES = {
  electronics: "Electronics & Gadgets", furniture: "Office Furniture",
  vehicles: "Vehicles & Fleet", supplies: "Industrial & Bulk Supplies",
  services: "Professional Services", real_estate: "Commercial Real Estate",
};

let selectedAuditId = null;

function fmtTime(iso){
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function loadAuditTrail(filterText = ''){
  const list = document.getElementById('auditList');
  if (!list) return;
  const records = JSON.parse(localStorage.getItem('parley_audit_trail') || '[]');
  const filtered = records.filter(r => {
    const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
    return `${catName} ${r.outcome}`.toLowerCase().includes(filterText.toLowerCase());
  });

  if (filtered.length === 0){
    list.innerHTML = `<div class="explain" style="padding:16px 0;">No negotiations recorded yet.</div>`;
    return;
  }

  const groups = {};
  filtered.forEach(r => {
    const dateKey = new Date(r.timestamp).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
    (groups[dateKey] = groups[dateKey] || []).push(r);
  });

  list.innerHTML = Object.keys(groups).map(dateKey => `
    <div class="audit-date-group">
      <div class="audit-date-label">${dateKey}</div>
      ${groups[dateKey].map(r => renderAuditListItem(r)).join('')}
    </div>
  `).join('');

  document.querySelectorAll('.audit-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedAuditId = Number(item.dataset.id);
      document.querySelectorAll('.audit-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      const rec = records.find(r => r.id === selectedAuditId);
      if (rec) renderAuditDetail(rec);
    });
  });
}

function renderAuditListItem(r){
  const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
  const time = new Date(r.timestamp).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${r.dealPrice?.toFixed(1)}` : r.outcome === 'walk' ? 'Buyer walked' : 'Timed out';
  const badgeClass = r.outcome === 'deal' ? 'deal' : r.outcome === 'walk' ? 'walk' : 'timeout';
  const selected = r.id === selectedAuditId ? 'selected' : '';
  return `
    <div class="audit-item ${selected}" data-id="${r.id}">
      <div class="audit-item-top">
        <span class="audit-item-cat">${catName}</span>
        <span class="audit-item-time">${time}</span>
      </div>
      <div class="audit-item-bottom">
        <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
        <span class="audit-item-rounds">${r.rounds.length} rounds</span>
      </div>
    </div>
  `;
}

function renderAuditDetail(r){
  const detail = document.getElementById('auditDetail');
  const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;

  let html = `<div class="chat-header"><span class="chat-header-cat">${catName}</span><span class="chat-header-date">${new Date(r.timestamp).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' })}</span></div>`;
  html += `<div class="chat-thread-detail">`;
  html += `<div class="chat-sys"><span class="chat-sys-time">${fmtTime(r.startedAt)}</span> Negotiation started</div>`;

  r.rounds.forEach(row => {
    html += `
      <div class="chat-bubble seller">
        <div class="chat-meta">You · Round ${row.round} <span>${fmtTime(row.at)}</span></div>
        <div class="chat-text">Asked for <b>${row.ask.toFixed(1)}</b></div>
      </div>
      <div class="chat-bubble buyer">
        <div class="chat-meta">Buyer agent · Round ${row.round} <span>${fmtTime(row.at)}</span></div>
        <div class="chat-text">Countered with <b>${row.offer.toFixed(1)}</b></div>
      </div>
    `;
  });

  let outcomeText, cls;
  if (r.outcome === 'deal'){ cls='deal'; outcomeText = `Deal closed at <b>${r.dealPrice?.toFixed(1)}</b> — buyer's hidden max was <b>${r.buyerMax?.toFixed(1)}</b>`; }
  else if (r.outcome === 'walk'){ cls='walk'; outcomeText = `Buyer walked away — hidden max was <b>${r.buyerMax?.toFixed(1)}</b>`; }
  else { cls='timeout'; outcomeText = `Timed out — buyer's hidden max was <b>${r.buyerMax?.toFixed(1)}</b>`; }
  html += `<div class="chat-sys ${cls}"><span class="chat-sys-time">${fmtTime(r.timestamp)}</span> ${outcomeText}</div>`;
  html += `</div>`;

  detail.innerHTML = html;
}

document.getElementById('auditSearch')?.addEventListener('input', (e) => {
  loadAuditTrail(e.target.value);
});

// hook into the existing nav-item click handler: when the audit view is selected, load it
document.querySelectorAll('.dash-nav-item').forEach(item => {
  if (item.dataset.view === 'audit'){
    item.addEventListener('click', () => loadAuditTrail());
  }
});

let learningChart = null;

async function loadLearningCurve(version = 'v3'){
  const canvas = document.getElementById('learningCurve');
  if (!canvas) return;
  const res = await fetch(`/api/training_log/${version}`);
  if (!res.ok){
    if (learningChart){ learningChart.destroy(); learningChart = null; }
    canvas.parentElement.innerHTML = `<div class="explain" style="padding:30px;text-align:center;">No training log found for ${version}.</div><canvas id="learningCurve" height="110"></canvas>`;
    return;
  }
  const rows = await res.json();

  const labels = rows.map(r => r.episode);
  const dealRate = rows.map(r => r.deal_rate * 100);
  const surplus = rows.map(r => r.avg_surplus_captured !== null ? r.avg_surplus_captured * 100 : null);
  const epsilon = rows.map(r => r.epsilon * 100);

  if (learningChart) learningChart.destroy();

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const deal = getComputedStyle(document.documentElement).getPropertyValue('--deal').trim();
  const dim = getComputedStyle(document.documentElement).getPropertyValue('--ink-dim').trim();

  learningChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Deal rate (%)', data: dealRate, borderColor: accent, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Surplus captured (%)', data: surplus, borderColor: deal, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
        { label: 'Exploration ε (%)', data: epsilon, borderColor: dim, backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [4,4], pointRadius: 0, tension: 0.3 },
      ]
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 11 } } },
        tooltip: { callbacks: { title: (items) => `Episode ${items[0].label}` } },
      },
      scales: {
        x: { title: { display: true, text: 'Episodes', font: { family: 'Inter', size: 11 } }, ticks: { maxTicksLimit: 8, font: { family: 'JetBrains Mono', size: 10 } }, grid: { display: false } },
        y: { min: 0, max: 100, title: { display: true, text: '%', font: { family: 'Inter', size: 11 } }, ticks: { font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(45,49,66,0.06)' } },
      }
    }
  });
}

document.getElementById('curveVersion')?.addEventListener('change', (e) => loadLearningCurve(e.target.value));

let insightsLoaded = false;
document.querySelectorAll('.dash-nav-item').forEach(item => {
  if (item.dataset.view === 'insights'){
    item.addEventListener('click', () => {
      if (!insightsLoaded){ loadLearningCurve('v3'); insightsLoaded = true; }
    });
  }
});

function openInAuditTrail(id){
  // switch to the audit view
  document.querySelectorAll('.dash-nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector('.dash-nav-item[data-view="audit"]').classList.add('active');
  document.querySelectorAll('.dash-view').forEach(v => {
    v.style.display = (v.id === 'view-audit') ? 'block' : 'none';
  });
  selectedAuditId = id;
  loadAuditTrail();
  const records = JSON.parse(localStorage.getItem('parley_audit_trail') || '[]');
  const rec = records.find(r => r.id === id);
  if (rec) renderAuditDetail(rec);
}

const miniCharts = {};

function timeAgo(iso){
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function fmtMoney(n){
  return n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(1)}`;
}

function cssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function makeMini(id, config){
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (miniCharts[id]) miniCharts[id].destroy();
  miniCharts[id] = new Chart(canvas, config);
}

function loadHome(){
  const records = JSON.parse(localStorage.getItem('parley_audit_trail') || '[]');
  const deals = records.filter(r => r.outcome === 'deal');

  // greeting
  const hour = new Date().getHours();
  const period = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = localStorage.getItem('parley_user_name');
  document.getElementById('greetingText').textContent = name ? `${period}, ${name}` : period;
  document.getElementById('greetingSub').textContent =
    records.length ? `${records.length} negotiations run · ${deals.length} deals closed` : 'No negotiations yet — pick a category to run your first one.';
  document.getElementById('nameSetter').style.display = name ? 'none' : 'flex';

  // top cards
  const dealRate = records.length ? deals.length / records.length : 0;
  document.getElementById('hcDealRate').textContent = records.length ? `${Math.round(dealRate*100)}%` : '—';
  document.getElementById('hcDealBar').style.width = `${Math.round(dealRate*100)}%`;
  document.getElementById('hcDealSub').textContent = records.length ? `${deals.length} of ${records.length} negotiations closed` : 'No negotiations yet';

  const value = deals.reduce((s, r) => s + ((r.dealPrice != null && r.sellerMin != null) ? Math.max(0, r.dealPrice - r.sellerMin) : 0), 0);
  document.getElementById('hcValue').textContent = deals.length ? fmtMoney(value) : '—';

  fetch('/api/session_status').then(r => r.json()).then(s => {
    const el = document.getElementById('hcProgress');
    if (s.active){
      const cat = CATEGORY_DISPLAY_NAMES[s.category] || s.category;
      el.innerHTML = `<div class="home-progress-active">Negotiation in progress — <b>${cat}</b>, round ${s.round}</div><a class="link-btn" href="/desk?category=${s.category}">Resume →</a>`;
    } else {
      el.innerHTML = `<span class="home-check">✓</span> You're all caught up`;
    }
  }).catch(()=>{});

  const accent = cssVar('--accent'), deal = cssVar('--deal'), line = cssVar('--line'), dim = cssVar('--ink-dim');
  const baseOpts = { responsive:true, plugins:{ legend:{display:false}, tooltip:{enabled:true} }, scales:{ x:{ grid:{display:false}, ticks:{ font:{family:'Inter', size:9}, color:dim } }, y:{ display:false } } };

  // by category
  const catCounts = {};
  records.forEach(r => { catCounts[r.category] = (catCounts[r.category]||0) + 1; });
  const catKeys = Object.keys(catCounts);
  document.getElementById('mcCatTotal').textContent = records.length ? `${records.length} total` : '';
  makeMini('miniCategory', { type:'bar', data:{ labels: catKeys.map(k => (CATEGORY_DISPLAY_NAMES[k]||k).split(' ')[0]), datasets:[{ data: catKeys.map(k => catCounts[k]), backgroundColor: accent, borderRadius:4 }] }, options: baseOpts });

  // activity this week (last 7 days)
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const dayCounts = days.map(d => records.filter(r => new Date(r.timestamp).toDateString() === d.toDateString()).length);
  document.getElementById('mcWeekTotal').textContent = `${dayCounts.reduce((a,b)=>a+b,0)} this week`;
  makeMini('miniWeek', { type:'bar', data:{ labels: days.map(d => d.toLocaleDateString(undefined,{weekday:'short'})), datasets:[{ data: dayCounts, backgroundColor: days.map((d,i) => i===6 ? accent : line), borderRadius:4 }] }, options: baseOpts });

  // success donut
  const walks = records.filter(r => r.outcome === 'walk').length;
  const timeouts = records.filter(r => r.outcome === 'timeout').length;
  document.getElementById('mcSuccessSub').textContent = records.length ? `${deals.length} ok · ${walks + timeouts} failed` : '';
  document.getElementById('donutCenter').textContent = records.length ? `${Math.round(dealRate*100)}%` : '—';
  makeMini('miniDonut', { type:'doughnut', data:{ labels:['Deals','Walked','Timed out'], datasets:[{ data:[deals.length, walks, timeouts], backgroundColor:[deal, cssVar('--walk'), cssVar('--timeout')], borderWidth:0 }] }, options:{ responsive:true, cutout:'72%', plugins:{ legend:{display:false} } } });

  // rounds to close sparkline (last 10 deals, oldest → newest)
  const lastDeals = deals.slice(0, 10).reverse();
  const avgRounds = lastDeals.length ? (lastDeals.reduce((s,r)=>s+r.rounds.length,0)/lastDeals.length) : 0;
  document.getElementById('mcRoundsAvg').textContent = lastDeals.length ? `avg ${avgRounds.toFixed(1)}` : '';
  makeMini('miniRounds', { type:'line', data:{ labels: lastDeals.map((_,i)=>i+1), datasets:[{ data: lastDeals.map(r=>r.rounds.length), borderColor: accent, backgroundColor:'transparent', borderWidth:2, pointRadius:2, tension:0.35 }] }, options:{ ...baseOpts, scales:{ x:{display:false}, y:{display:false, min:0} } } });

  // recent list
  const list = document.getElementById('recentList');
  const recent = records.slice(0, 6);
  list.innerHTML = recent.length ? recent.map(r => {
    const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
    const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${r.dealPrice?.toFixed(1)}` : r.outcome === 'walk' ? 'Buyer walked' : 'Timed out';
    const badgeClass = r.outcome === 'deal' ? 'deal' : r.outcome === 'walk' ? 'walk' : 'timeout';
    return `<div class="recent-item" data-id="${r.id}">
      <div class="recent-item-main"><div class="recent-item-cat">${catName}</div><div class="recent-item-meta">${r.rounds.length} rounds</div></div>
      <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
      <span class="recent-item-time">${timeAgo(r.timestamp)}</span>
    </div>`;
  }).join('') : `<div class="recent-empty">No negotiations yet.</div>`;
  document.querySelectorAll('.recent-item').forEach(item => item.addEventListener('click', () => openInAuditTrail(Number(item.dataset.id))));

  // activity feed (latest round events across recent negotiations)
  const events = [];
  records.slice(0, 5).forEach(r => {
    const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
    r.rounds.forEach(row => {
      if (row.at) events.push({ at: row.at, cat: catName, text: `Buyer countered with <b>${row.offer.toFixed(1)}</b> after your ask of <b>${row.ask.toFixed(1)}</b>`, round: row.round });
    });
  });
  events.sort((a,b) => new Date(b.at) - new Date(a.at));
  const feed = document.getElementById('activityFeed');
  feed.innerHTML = events.length ? events.slice(0, 8).map(e => `
    <div class="feed-item">
      <div class="feed-avatar">🤖</div>
      <div class="feed-body"><div class="feed-top"><span class="feed-who">Buyer agent</span><span class="feed-cat">${e.cat} · Round ${e.round}</span><span class="feed-time">${timeAgo(e.at)}</span></div><div class="feed-text">${e.text}</div></div>
    </div>`).join('') : `<div class="recent-empty">Agent activity will appear here as you negotiate.</div>`;
}

document.getElementById('nameSave')?.addEventListener('click', () => {
  const v = document.getElementById('nameInput').value.trim();
  if (v){ localStorage.setItem('parley_user_name', v); loadHome(); }
});
document.getElementById('allNegotiationsBtn')?.addEventListener('click', () => {
  document.querySelector('.dash-nav-item[data-view="audit"]').click();
});

loadHome();
document.querySelectorAll('.dash-nav-item').forEach(item => {
  if (item.dataset.view === 'dashboard') item.addEventListener('click', () => loadHome());
});
