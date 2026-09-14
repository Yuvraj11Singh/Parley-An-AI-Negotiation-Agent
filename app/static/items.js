const urlParams = new URLSearchParams(window.location.search);
const categoryId = urlParams.get('category');

const grid = document.getElementById('itemGrid');
const heading = document.getElementById('categoryHeading');
const sub = document.getElementById('categorySub');

function fmtRange(min, max){
  const f = n => `$${n.toLocaleString()}`;
  return `${f(min)} – ${f(max)}`;
}

fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    const { categories, items } = data;
    const cat = categories[categoryId];

    heading.textContent = cat ? cat.name : 'Items';
    sub.textContent = cat ? `Choose an item to start negotiating.` : 'Unknown category.';

    const matches = Object.keys(items)
      .filter(id => items[id].category === categoryId)
      .map(id => ({ id, ...items[id] }));

    if (matches.length === 0){
      grid.innerHTML = `<div class="recent-empty">No items found for this category.</div>`;
      return;
    }

    grid.innerHTML = matches.map(item => `
      <div class="item-card">
        <div class="item-name">${item.name}</div>
        <div class="item-desc">${item.description}</div>
        <ul class="item-details">
          ${item.details.map(d => `<li>${d}</li>`).join('')}
        </ul>
        <div class="item-range">${fmtRange(item.min, item.max)}</div>
        <a href="/desk?item=${item.id}" class="primary">Negotiate this →</a>
      </div>
    `).join('');
  });
