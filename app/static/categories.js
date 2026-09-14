const grid = document.getElementById('categoryGrid');

fetch('/api/categories')
  .then(res => res.json())
  .then(data => {
    const { categories, items } = data;
    const itemCounts = {};
    Object.values(items).forEach(item => {
      itemCounts[item.category] = (itemCounts[item.category] || 0) + 1;
    });

    Object.keys(categories).forEach(id => {
      const cat = categories[id];
      const count = itemCounts[id] || 0;
      const card = document.createElement('a');
      card.className = 'category-card';
      card.href = `/items?category=${id}`;
      card.innerHTML = `
        <div class="category-icon">${cat.icon}</div>
        <div class="category-name">${cat.name}</div>
        <div class="category-range">${count} item${count === 1 ? '' : 's'}</div>
      `;
      grid.appendChild(card);
    });
  });
