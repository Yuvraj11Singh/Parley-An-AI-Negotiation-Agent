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

function loadAuditTrail(filterText = ''){
  const list = document.getElementById('auditList');
  if (!list) return;
  const records = JSON.parse(localStorage.getItem('parley_audit_trail') || '[]');
  const filtered = records.filter(r => {
    const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
    const haystack = `${catName} ${r.outcome}`.toLowerCase();
    return haystack.includes(filterText.toLowerCase());
  });

  if (filtered.length === 0){
    list.innerHTML = `<div class="explain" style="padding:20px 0;">No negotiations recorded yet — completed negotiations on the desk page will appear here.</div>`;
    return;
  }

  const groups = {};
  filtered.forEach(r => {
    const dateKey = new Date(r.timestamp).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(r);
  });

  list.innerHTML = Object.keys(groups).map(dateKey => `
    <div class="audit-date-group">
      <div class="audit-date-label">${dateKey}</div>
      ${groups[dateKey].map(r => renderAuditEntry(r)).join('')}
    </div>
  `).join('');

  document.querySelectorAll('.audit-entry-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('expanded');
    });
  });
}

function renderAuditEntry(r){
  const catName = CATEGORY_DISPLAY_NAMES[r.category] || r.category;
  const time = new Date(r.timestamp).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  const outcomeLabel = r.outcome === 'deal' ? `Deal @ ${r.dealPrice?.toFixed(1)}` : r.outcome === 'walk' ? 'Buyer walked' : 'Timed out';
  const badgeClass = r.outcome === 'deal' ? 'deal' : r.outcome === 'walk' ? 'walk' : 'timeout';

  const roundsHtml = r.rounds.map(row => `
    <div class="round-row">
      <div class="round-badge">${row.round}</div>
      <div class="side seller-side"><div class="label">Ask</div><div class="value">${row.ask.toFixed(1)}</div></div>
      <div class="arrow">⇌</div>
      <div class="side buyer-side"><div class="label">Offer</div><div class="value">${row.offer.toFixed(1)}</div></div>
    </div>
  `).join('');

  return `
    <div class="audit-entry">
      <div class="audit-entry-header">
        <span class="audit-entry-cat">${catName}</span>
        <span class="audit-entry-time">${time}</span>
        <span class="audit-badge ${badgeClass}">${outcomeLabel}</span>
      </div>
      <div class="audit-entry-detail">${roundsHtml}</div>
    </div>
  `;
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
