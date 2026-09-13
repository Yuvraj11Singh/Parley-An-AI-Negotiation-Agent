const CATEGORY_META = {
  electronics: { icon: "💻", range: "$350 – $650" },
  furniture: { icon: "🪑", range: "$210 – $390" },
  vehicles: { icon: "🚚", range: "$21,000 – $39,000" },
  supplies: { icon: "📦", range: "$10,500 – $19,500" },
  services: { icon: "🧰", range: "$5,600 – $10,400" },
  real_estate: { icon: "🏢", range: "$140,000 – $260,000" },
};

const CATEGORY_NAMES = {
  electronics: "Electronics & Gadgets",
  furniture: "Office Furniture",
  vehicles: "Vehicles & Fleet",
  supplies: "Industrial & Bulk Supplies",
  services: "Professional Services",
  real_estate: "Commercial Real Estate",
};

const grid = document.getElementById('categoryGrid');

Object.keys(CATEGORY_META).forEach(id => {
  const meta = CATEGORY_META[id];
  const card = document.createElement('a');
  card.className = 'category-card';
  card.href = `/desk?category=${id}`;
  card.innerHTML = `
    <div class="category-icon">${meta.icon}</div>
    <div class="category-name">${CATEGORY_NAMES[id]}</div>
    <div class="category-range">${meta.range}</div>
  `;
  grid.appendChild(card);
});
