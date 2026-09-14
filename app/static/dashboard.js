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
