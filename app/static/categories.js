const grid = document.getElementById('categoryGrid');

const modal = document.getElementById('itemModal');
const modalCategoryName = document.getElementById('modalCategoryName');
const quickfillRow = document.getElementById('quickfillRow');
const mfName = document.getElementById('mfName');
const mfDesc = document.getElementById('mfDesc');
const mfDetails = document.getElementById('mfDetails');
const mfQty = document.getElementById('mfQty');
const mfRef = document.getElementById('mfRef');
const mfError = document.getElementById('mfError');
const modalClose = document.getElementById('modalClose');
const modalCancel = document.getElementById('modalCancel');
const modalStart = document.getElementById('modalStart');

const mfPolicyWarning = document.getElementById('mfPolicyWarning');
const mfPolicyText = document.getElementById('mfPolicyText');
const modalPolicyActions = document.getElementById('modalPolicyActions');
const modalFixIt = document.getElementById('modalFixIt');
const modalProceedAnyway = document.getElementById('modalProceedAnyway');

let CATALOG = { categories: {}, items: {} };
let categoryBands = {};
let activeCategoryId = null;

function computeCategoryBands(items){
  const bands = {};
  Object.values(items).forEach(item => {
    const b = bands[item.category] || { min: Infinity, max: -Infinity };
    b.min = Math.min(b.min, item.min);
    b.max = Math.max(b.max, item.max);
    bands[item.category] = b;
  });
  return bands;
}

function checkPolicy(categoryId, refPrice, quantity){
  const issues = [];
  const band = categoryBands[categoryId];
  if (band && refPrice != null){
    // allow some headroom beyond the observed item range before flagging
    const lo = band.min * 0.5, hi = band.max * 2;
    if (refPrice < lo || refPrice > hi){
      issues.push({
        type: 'price',
        text: `$${refPrice.toLocaleString()} is well outside the typical range for this category ($${Math.round(band.min).toLocaleString()} – $${Math.round(band.max).toLocaleString()}). Double-check the reference price, or proceed if this is intentional.`
      });
    }
  }
  if (!quantity){
    issues.push({
      type: 'quantity',
      text: `No quantity specified — this negotiation will proceed without it.`
    });
  }
  return issues;
}

function showError(text){
  mfError.textContent = text;
  mfError.style.display = 'block';
}

function clearError(){
  mfError.textContent = '';
  mfError.style.display = 'none';
}

function resetPolicyWarning(){
  mfPolicyWarning.style.display = 'none';
  mfPolicyText.innerHTML = '';
  modalPolicyActions.style.display = 'none';
  modalStart.parentElement.style.display = 'flex';
}

function openModal(categoryId){
  activeCategoryId = categoryId;
  const cat = CATALOG.categories[categoryId];
  modalCategoryName.textContent = cat ? cat.name : 'Category';

  // reset the form
  mfName.value = '';
  mfDesc.value = '';
  mfDetails.value = '';
  mfQty.value = '';
  mfRef.value = '';
  clearError();
  resetPolicyWarning();

  const items = Object.keys(CATALOG.items)
    .filter(id => CATALOG.items[id].category === categoryId)
    .map(id => ({ id, ...CATALOG.items[id] }));

  quickfillRow.innerHTML = items.map(item => `
    <button type="button" class="quickfill-chip" data-item-id="${item.id}">${item.name}</button>
  `).join('');

  quickfillRow.querySelectorAll('.quickfill-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const item = CATALOG.items[chip.dataset.itemId];
      mfName.value = item.name;
      mfDesc.value = item.description;
      mfDetails.value = item.details.join('\n');
      const qtyMatch = item.name.match(/—\s*(\d+)\s*units?/i);
      mfQty.value = qtyMatch ? qtyMatch[1] : '';
      mfRef.value = Math.round((item.min + item.max) / 2);
    });
  });

  modal.style.display = 'flex';
}

function closeModal(){
  modal.style.display = 'none';
  activeCategoryId = null;
  resetPolicyWarning();
}

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

document.getElementById('modalStart').addEventListener('click', () => {
  const name = document.getElementById('mfName').value.trim();
  const refPrice = parseFloat(document.getElementById('mfRef').value);
  const quantity = document.getElementById('mfQty').value;

  if (!name || isNaN(refPrice) || refPrice <= 0){
    showError('Enter an item name and a valid reference price.');
    return;
  }
  clearError();

  const issues = checkPolicy(activeCategoryId, refPrice, quantity);
  if (issues.length > 0){
    showPolicyWarning(issues);
    return;
  }
  proceedToNegotiation();
});

function showPolicyWarning(issues){
  document.getElementById('mfPolicyText').innerHTML = issues.map(i => i.text).join('<br><br>');
  document.getElementById('mfPolicyWarning').style.display = 'flex';
  document.getElementById('modalStart').parentElement.style.display = 'none'; // hide the original Cancel/Start row
  document.getElementById('modalPolicyActions').style.display = 'flex';
}

document.getElementById('modalFixIt').addEventListener('click', () => {
  document.getElementById('mfPolicyWarning').style.display = 'none';
  document.getElementById('modalPolicyActions').style.display = 'none';
  document.getElementById('modalStart').parentElement.style.display = 'flex';
  document.getElementById('mfRef').focus();
});

document.getElementById('modalProceedAnyway').addEventListener('click', () => {
  proceedToNegotiation();
});

function proceedToNegotiation(){
  const name = mfName.value.trim();
  const refPrice = parseFloat(mfRef.value);

  const payload = {
    name,
    description: mfDesc.value.trim(),
    details: mfDetails.value.split('\n').map(s => s.trim()).filter(Boolean),
    quantity: mfQty.value ? parseInt(mfQty.value, 10) : null,
    reference_price: refPrice,
  };

  sessionStorage.setItem('parley_pending_item', JSON.stringify(payload));
  window.location.href = `/desk?category=${activeCategoryId}&custom=1`;
}

fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    CATALOG = data;
    const { categories, items } = data;
    categoryBands = computeCategoryBands(items);
    const itemCounts = {};
    Object.values(items).forEach(item => {
      itemCounts[item.category] = (itemCounts[item.category] || 0) + 1;
    });

    Object.keys(categories).forEach(id => {
      const cat = categories[id];
      const count = itemCounts[id] || 0;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'category-card';
      card.dataset.category = id;
      card.innerHTML = `
        <div class="category-icon">${cat.icon}</div>
        <div class="category-name">${cat.name}</div>
        <div class="category-range">${count} item${count === 1 ? '' : 's'}</div>
      `;
      card.addEventListener('click', () => openModal(id));
      grid.appendChild(card);
    });
  });
