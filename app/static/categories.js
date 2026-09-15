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

let CATALOG = { categories: {}, items: {} };
let activeCategoryId = null;

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
  mfError.style.display = 'none';
  mfError.textContent = '';

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
}

modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

modalStart.addEventListener('click', () => {
  const name = mfName.value.trim();
  const refPrice = parseFloat(mfRef.value);

  if (!name || isNaN(refPrice) || refPrice <= 0){
    mfError.textContent = !name
      ? 'Please enter an item name.'
      : 'Please enter a valid reference price (a positive number).';
    mfError.style.display = 'block';
    return;
  }

  const payload = {
    name,
    description: mfDesc.value.trim(),
    details: mfDetails.value.split('\n').map(s => s.trim()).filter(Boolean),
    quantity: mfQty.value ? parseInt(mfQty.value, 10) : null,
    reference_price: refPrice,
  };

  sessionStorage.setItem('parley_pending_item', JSON.stringify(payload));
  window.location.href = `/desk?category=${activeCategoryId}&custom=1`;
});

fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    CATALOG = data;
    const { categories, items } = data;
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
