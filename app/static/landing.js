// Scroll-triggered reveal for the how-it-works section.
const revealTargets = document.querySelectorAll('[data-reveal]');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting){
      entry.target.style.animationDelay = `${i * 0.12}s`;
      entry.target.classList.add('reveal-in');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.2 });

revealTargets.forEach(el => observer.observe(el));
