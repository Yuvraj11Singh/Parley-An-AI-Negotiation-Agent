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

// Scrollspy: highlight the nav link for whichever section is currently in view.
const navLinks = document.querySelectorAll('.landing-nav-links a[href^="#"]');
if (navLinks.length){
  const sectionsByLink = new Map();
  navLinks.forEach(link => {
    const section = document.getElementById(link.getAttribute('href').slice(1));
    if (section) sectionsByLink.set(section, link);
  });
  const spyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const link = sectionsByLink.get(entry.target);
      if (!link) return;
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });
  sectionsByLink.forEach((_, section) => spyObserver.observe(section));
}
