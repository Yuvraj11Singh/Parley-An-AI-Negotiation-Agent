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

let CATEGORY_DISPLAY_NAMES = {};

function recordLabel(r){
  const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
  return r.itemName ? `${r.itemName} · ${catName}` : catName;
}

let selectedAuditId = null;

function fmtTime(iso){
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function loadAuditTrail(filterText = ''){
  const list = document.getElementById('auditList');
  if (!list) return;
  // normalized (v2) records — same function the Dashboard/Agent Insights
  // aggregates use, so an old record's telemetry/maxRounds/dealTerms are
  // always present (backfilled, never guessed) by the time anything reads
  // them (Section 18)
  const records = loadNegotiationRecords();
  const filtered = records.filter(r => {
    return `${recordLabel(r)} ${r.outcome}`.toLowerCase().includes(filterText.toLowerCase());
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
  const time = new Date(r.timestamp).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  const isSafeguardWalk = r.outcome === 'walk' && (r.walkReason === 'safeguard' || r.walkReason === 'seller_stalled');
  const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${fmtPrice(r.dealPrice)}` : isSafeguardWalk ? 'Safeguard walk-away' : r.outcome === 'walk' ? 'Buyer walked' : 'Timed out';
  const badgeClass = r.outcome === 'deal' ? 'deal' : isSafeguardWalk ? 'walk-safeguard' : r.outcome === 'walk' ? 'walk' : 'timeout';
  const selected = r.id === selectedAuditId ? 'selected' : '';
  return `
    <div class="audit-item ${selected}" data-id="${r.id}">
      <div class="audit-item-top">
        <span class="audit-item-cat">${recordLabel(r)}</span>
        <span class="audit-item-time">${time}</span>
      </div>
      <div class="audit-item-bottom">
        <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
        <span class="audit-item-rounds">${r.rounds.length} rounds</span>
      </div>
    </div>
  `;
}

// the safeguard's real condition is "neither side moved for N rounds" — it
// can fire with Parley still below its maximum, so the maximum is only
// mentioned when the final round's at_limit genuinely was true (older
// records never captured atLimit, so this honestly falls back to the
// generic phrasing rather than guessing)
function buildFinalOutcomeLine(r){
  const lastRound = r.rounds.length ? r.rounds[r.rounds.length - 1] : null;
  const wasAtLimit = !!(lastRound && lastRound.atLimit);
  const holdRounds = r.safeguardHoldRounds;
  let outcomeText, cls;
  if (r.outcome === 'deal'){ cls='deal'; outcomeText = `Deal closed at <b>${fmtPrice(r.dealPrice)}</b> — Parley's reservation price was <b>${fmtPrice(r.buyerMax)}</b>`; }
  else if (r.outcome === 'walk' && (r.walkReason === 'safeguard' || r.walkReason === 'seller_stalled')){
    cls='walk-safeguard';
    const roundsPhrase = holdRounds ? `${holdRounds} rounds` : 'several rounds';
    outcomeText = wasAtLimit
      ? `Walk-away safeguard fired — Parley reached its reservation price (<b>${fmtPrice(r.buyerMax)}</b>) and neither side moved for ${roundsPhrase}`
      : `Walk-away safeguard fired — neither side moved for ${roundsPhrase}`;
  }
  else if (r.outcome === 'walk'){ cls='walk'; outcomeText = `Buyer walked away — Parley's reservation price was <b>${fmtPrice(r.buyerMax)}</b>`; }
  else { cls='timeout'; outcomeText = `Timed out after ${r.rounds.length} rounds`; }
  return `<div class="chat-sys ${cls}"><span class="chat-sys-time">${fmtTime(r.timestamp)}</span> ${outcomeText}</div>`;
}

function buildRoundBubbles(r, upToIndex){
  return r.rounds.slice(0, upToIndex + 1).map(row => {
    // records saved before the negotiation-language system existed never
    // captured a statement — shown as numbers only, never generated after
    // the fact
    const buyerText = row.statement
      ? `<div class="chat-text-label">${row.statementLabel || 'PARLEY'}</div><div class="chat-text">"${row.statement}"</div><div class="chat-text chat-text-value"><b>${fmtPrice(row.offer)}</b></div>`
      : `<div class="chat-text">Countered with <b>${fmtPrice(row.offer)}</b></div>`;
    return `
      <div class="chat-bubble seller">
        <div class="chat-meta">You · Round ${row.round} <span>${fmtTime(row.at)}</span></div>
        <div class="chat-text">Asked for <b>${fmtPrice(row.ask)}</b></div>
      </div>
      <div class="chat-bubble buyer">
        <div class="chat-meta">Buyer agent · Round ${row.round} <span>${fmtTime(row.at)}</span></div>
        ${buyerText}
      </div>
    `;
  }).join('');
}

// --- Negotiation Replay (Section 5) ---------------------------------------
// Lightweight: an index into r.rounds, stepped by Play/Pause/Next/Prev/
// Restart. Renders the SAME bubbles the full transcript always rendered —
// replay just reveals them progressively instead of all at once. Not a
// video editor: no scrubbing, no timeline drag, just the controls asked for.
let replayRecord = null;
let replayIndex = -1;   // -1 = nothing shown yet, "Negotiation started" only
let replayTimer = null;
const REPLAY_STEP_MS = 1100;

function stopReplayTimer(){
  if (replayTimer){ clearInterval(replayTimer); replayTimer = null; }
  const playBtn = document.getElementById('replayPlay');
  if (playBtn) playBtn.textContent = '▶ Play';
}

function renderReplayStep(){
  if (!replayRecord) return;
  const r = replayRecord;
  const thread = document.getElementById('replayThread');
  const counter = document.getElementById('replayCounter');
  if (!thread) return;

  let html = `<div class="chat-sys"><span class="chat-sys-time">${fmtTime(r.startedAt)}</span> Negotiation started</div>`;
  if (replayIndex >= 0){
    html += buildRoundBubbles(r, replayIndex);
    if (replayIndex === r.rounds.length - 1){
      html += buildFinalOutcomeLine(r);
    }
  }
  thread.innerHTML = html;
  thread.scrollTop = thread.scrollHeight;

  if (counter) counter.textContent = `Round ${replayIndex + 1} / ${r.rounds.length}`;
  const prevBtn = document.getElementById('replayPrev');
  const nextBtn = document.getElementById('replayNext');
  if (prevBtn) prevBtn.disabled = replayIndex < 0;
  if (nextBtn) nextBtn.disabled = replayIndex >= r.rounds.length - 1;
  if (nextBtn && nextBtn.disabled) stopReplayTimer();
}

function replayGoTo(index){
  if (!replayRecord) return;
  replayIndex = Math.max(-1, Math.min(replayRecord.rounds.length - 1, index));
  renderReplayStep();
}

function replayTogglePlay(){
  if (!replayRecord) return;
  if (replayTimer){ stopReplayTimer(); return; }
  if (replayIndex >= replayRecord.rounds.length - 1) replayIndex = -1; // restart if at the end
  const playBtn = document.getElementById('replayPlay');
  if (playBtn) playBtn.textContent = '❚❚ Pause';
  replayTimer = setInterval(() => {
    if (!replayRecord || replayIndex >= replayRecord.rounds.length - 1){ stopReplayTimer(); return; }
    replayGoTo(replayIndex + 1);
  }, REPLAY_STEP_MS);
}

document.getElementById('auditDetail')?.addEventListener('click', (e) => {
  if (e.target.id === 'replayRestart') { stopReplayTimer(); replayGoTo(-1); }
  else if (e.target.id === 'replayPrev') { stopReplayTimer(); replayGoTo(replayIndex - 1); }
  else if (e.target.id === 'replayNext') { stopReplayTimer(); replayGoTo(replayIndex + 1); }
  else if (e.target.id === 'replayPlay') { replayTogglePlay(); }
});

let trajectoryChart = null;

function renderTrajectoryChart(r){
  const canvas = document.getElementById('trajectoryChart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (trajectoryChart){ trajectoryChart.destroy(); trajectoryChart = null; }
  const trajectory = computeTrajectory(r);
  if (trajectory.rounds.length < 2) return; // a 1-round chart isn't a trajectory

  const accent = cssVar('--accent'), dim = cssVar('--ink-dim');
  trajectoryChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: trajectory.rounds.map(n => `R${n}`),
      datasets: [
        { label: "Seller's ask", data: trajectory.sellerSeries, borderColor: dim, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, tension: 0.25 },
        { label: "Parley's offer", data: trajectory.parleySeries, borderColor: accent, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, tension: 0.25 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 11 } } },
        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${fmtPrice(item.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 } } },
        y: { ticks: { font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => fmtPrice(v) }, grid: { color: 'rgba(45,49,66,0.06)' } },
      },
    },
  });
}

function renderAuditDetail(r){
  const detail = document.getElementById('auditDetail');
  const autopsy = computeAutopsy(r);

  let html = `<div class="chat-header"><span class="chat-header-cat">${recordLabel(r)}</span><span class="chat-header-date">${new Date(r.timestamp).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' })}</span></div>`;

  if (autopsy) html += buildAutopsyHtml(autopsy);

  if (autopsy && r.rounds.length >= 2){
    html += `
      <div class="trajectory-card">
        <div class="autopsy-header">Negotiation Trajectory</div>
        <div class="trajectory-chart-wrap"><canvas id="trajectoryChart"></canvas></div>
      </div>
    `;
  }

  if (autopsy) html += buildSellerBehaviorHtml(autopsy.sellerBehavior);

  html += `
    <div class="replay-card">
      <div class="replay-header">
        <span class="autopsy-header" style="margin:0;">Negotiation Replay</span>
        <div class="replay-controls">
          <button id="replayRestart" title="Replay from beginning">⟲</button>
          <button id="replayPrev" title="Previous round">‹ Prev</button>
          <button id="replayPlay" title="Play/Pause">▶ Play</button>
          <button id="replayNext" title="Next round">Next ›</button>
          <span id="replayCounter" class="replay-counter"></span>
        </div>
      </div>
      <div class="chat-thread-detail" id="replayThread"></div>
    </div>
  `;

  detail.innerHTML = html;

  stopReplayTimer();
  replayRecord = r;
  replayIndex = -1;
  renderReplayStep();
  renderTrajectoryChart(r);
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

// Section 10: "Your Negotiation Behavior" — computed from this browser's
// own stored negotiations (loadNegotiationRecords), not the offline
// scripted evaluation above it. Gated on a minimum sample size so a
// 1-2 negotiation "average" never gets presented as a real pattern.
const BEHAVIOR_MIN_SAMPLE = 3;
function loadBehaviorStats(){
  const records = loadNegotiationRecords();
  const stats = computeBehaviorStats(records);
  const empty = document.getElementById('behaviorEmpty');
  const content = document.getElementById('behaviorContent');
  if (!empty || !content) return;

  if (stats.total < BEHAVIOR_MIN_SAMPLE){
    empty.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';

  document.getElementById('bvOutcomeRates').textContent =
    `${Math.round((stats.dealRate||0)*100)}% / ${Math.round((stats.walkRate||0)*100)}% / ${Math.round((stats.timeoutRate||0)*100)}%`;
  document.getElementById('bvAvgRounds').textContent = stats.avgRounds != null ? stats.avgRounds.toFixed(1) : '—';
  document.getElementById('bvAvgSavings').textContent = stats.avgSavings != null ? fmtPrice(stats.avgSavings) : '—';
  document.getElementById('bvHoldFreq').textContent = stats.holdFrequency != null ? `${stats.holdFrequency.toFixed(0)}%` : '—';
  document.getElementById('bvConcessionFreq').textContent = stats.concessionFrequency != null ? `${stats.concessionFrequency.toFixed(0)}% of rounds were concessions` : '';
  document.getElementById('bvRoundsToFirstConcession').textContent = stats.avgRoundsToFirstConcession != null ? stats.avgRoundsToFirstConcession.toFixed(1) : '—';
  document.getElementById('bvOpeningDistance').textContent = stats.avgOpeningDistance != null ? `${(stats.avgOpeningDistance*100).toFixed(0)}%` : '—';
}

let insightsLoaded = false;
document.querySelectorAll('.dash-nav-item').forEach(item => {
  if (item.dataset.view === 'insights'){
    item.addEventListener('click', () => {
      loadBehaviorStats(); // cheap + always current; recompute every visit
      if (!insightsLoaded){ loadLearningCurve('v6'); insightsLoaded = true; }
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
  const records = loadNegotiationRecords();
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

let gapByRoundChart = null;

function loadHome(){
  // normalized (v2) records — same source of truth used everywhere else
  // (Audit Trail, Agent Insights) so a metric here can never drift from
  // what those pages compute over the same data (Section 18)
  const records = loadNegotiationRecords();
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

  // Section 12: "reservation price", never "authorized maximum" — Parley's
  // maximum isn't an external permission, it's its own reservation price
  // (same correction already made to the walk-away safeguard copy)
  const savings = deals.reduce((s, r) => s + (r.valueCaptured != null ? r.valueCaptured : 0), 0);
  const avgSaving = deals.length ? savings / deals.length : 0;
  document.getElementById('hcValue').textContent = deals.length ? fmtMoney(savings) : '—';
  document.getElementById('hcValueSub').textContent = deals.length
    ? `Avg ${fmtMoney(avgSaving)} saved per deal · below Parley's reservation price`
    : "What Parley saved below its reservation price, across closed deals";

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
  const baseOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{enabled:true} }, scales:{ x:{ grid:{display:false}, ticks:{ font:{family:'Inter', size:9}, color:dim } }, y:{ display:false } } };

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
  makeMini('miniDonut', { type:'doughnut', data:{ labels:['Deals','Walked','Timed out'], datasets:[{ data:[deals.length, walks, timeouts], backgroundColor:[deal, cssVar('--walk'), cssVar('--timeout')], borderWidth:0 }] }, options:{ responsive:true, maintainAspectRatio:false, cutout:'72%', plugins:{ legend:{display:false} } } });

  // rounds to close sparkline (last 10 deals, oldest → newest)
  const lastDeals = deals.slice(0, 10).reverse();
  const avgRounds = lastDeals.length ? (lastDeals.reduce((s,r)=>s+r.rounds.length,0)/lastDeals.length) : 0;
  document.getElementById('mcRoundsAvg').textContent = lastDeals.length ? `avg ${avgRounds.toFixed(1)}` : '';
  makeMini('miniRounds', { type:'line', data:{ labels: lastDeals.map((_,i)=>i+1), datasets:[{ data: lastDeals.map(r=>r.rounds.length), borderColor: accent, backgroundColor:'transparent', borderWidth:2, pointRadius:2, tension:0.35 }] }, options:{ ...baseOpts, scales:{ x:{display:false}, y:{display:false, min:0} } } });

  // recent list
  const list = document.getElementById('recentList');
  const recent = records.slice(0, 6);
  list.innerHTML = recent.length ? recent.map(r => {
    const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${r.dealPrice?.toFixed(1)}` : r.outcome === 'walk' ? 'Buyer walked' : 'Timed out';
    const badgeClass = r.outcome === 'deal' ? 'deal' : r.outcome === 'walk' ? 'walk' : 'timeout';
    return `<div class="recent-item" data-id="${r.id}">
      <div class="recent-item-main"><div class="recent-item-cat">${recordLabel(r)}</div><div class="recent-item-meta">${r.rounds.length} rounds</div></div>
      <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
      <span class="recent-item-time">${timeAgo(r.timestamp)}</span>
    </div>`;
  }).join('') : `<div class="recent-empty">No negotiations yet.</div>`;
  document.querySelectorAll('.recent-item').forEach(item => item.addEventListener('click', () => openInAuditTrail(Number(item.dataset.id))));

  // activity feed (latest round events across recent negotiations)
  const events = [];
  records.slice(0, 5).forEach(r => {
    r.rounds.forEach(row => {
      if (row.at) events.push({ at: row.at, cat: recordLabel(r), text: `Buyer countered with <b>${fmtPrice(row.offer)}</b> after your ask of <b>${fmtPrice(row.ask)}</b>`, round: row.round });
    });
  });
  events.sort((a,b) => new Date(b.at) - new Date(a.at));
  const feed = document.getElementById('activityFeed');
  feed.innerHTML = events.length ? events.slice(0, 8).map(e => `
    <div class="feed-item">
      <div class="feed-avatar">🤖</div>
      <div class="feed-body"><div class="feed-top"><span class="feed-who">Buyer agent</span><span class="feed-cat">${e.cat} · Round ${e.round}</span><span class="feed-time">${timeAgo(e.at)}</span></div><div class="feed-text">${e.text}</div></div>
    </div>`).join('') : `<div class="recent-empty">Agent activity will appear here as you negotiate.</div>`;

  // --- negotiation intelligence: aggregate stats (Sections 8-9) -----------
  // Gated on a minimum sample size — a 1-negotiation "average" isn't a
  // meaningful business metric, so these stay hidden rather than show a
  // misleading number (per Section 9's explicit instruction).
  const stats = computeAggregateStats(records);
  const intelRow = document.getElementById('homeIntelRow');
  const gapSection = document.getElementById('gapByRoundSection');
  const MIN_SAMPLE = 3;

  if (stats.sampleSize >= MIN_SAMPLE){
    intelRow.style.display = 'grid';
    document.getElementById('hiSellerConcession').textContent = stats.avgSellerConcession != null ? fmtPrice(stats.avgSellerConcession) : '—';
    document.getElementById('hiParleyConcession').textContent = stats.avgParleyConcession != null ? fmtPrice(stats.avgParleyConcession) : '—';
    document.getElementById('hiClosingGap').textContent = stats.avgClosingGap != null ? fmtPrice(stats.avgClosingGap) : '—';
    document.getElementById('hiWalkTimeout').textContent = stats.total
      ? `${Math.round((stats.walkRate || 0) * 100)}% / ${Math.round((stats.timeoutRate || 0) * 100)}%`
      : '—';
  } else {
    intelRow.style.display = 'none';
  }

  if (stats.gapByRoundSeries.filter(p => p.count >= MIN_SAMPLE).length >= 2){
    gapSection.style.display = 'block';
    const series = stats.gapByRoundSeries.filter(p => p.count >= MIN_SAMPLE);
    if (gapByRoundChart){ gapByRoundChart.destroy(); gapByRoundChart = null; }
    gapByRoundChart = new Chart(document.getElementById('gapByRoundChart'), {
      type: 'line',
      data: {
        labels: series.map(p => `R${p.round}`),
        datasets: [{ data: series.map(p => p.avgGap), borderColor: accent, backgroundColor: 'transparent', borderWidth: 2, pointRadius: 3, tension: 0.25 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => `Avg gap: ${fmtPrice(item.parsed.y)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 10 } } },
          y: { ticks: { font: { family: 'JetBrains Mono', size: 10 }, callback: (v) => fmtPrice(v) }, grid: { color: 'rgba(45,49,66,0.06)' } },
        },
      },
    });
  } else {
    gapSection.style.display = 'none';
  }
}

document.getElementById('nameSave')?.addEventListener('click', () => {
  const v = document.getElementById('nameInput').value.trim();
  if (v){ localStorage.setItem('parley_user_name', v); loadHome(); }
});
document.getElementById('allNegotiationsBtn')?.addEventListener('click', () => {
  document.querySelector('.dash-nav-item[data-view="audit"]').click();
});

fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    Object.keys(data.categories).forEach(id => {
      CATEGORY_DISPLAY_NAMES[id] = data.categories[id].name;
    });
    loadHome();
  })
  .catch(() => loadHome());

document.querySelectorAll('.dash-nav-item').forEach(item => {
  if (item.dataset.view === 'dashboard') item.addEventListener('click', () => loadHome());
});
