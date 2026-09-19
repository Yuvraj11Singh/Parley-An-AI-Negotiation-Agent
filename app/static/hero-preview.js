// Illustrative negotiation sequence for the hero preview.
// This is a scripted, self-contained visual demo — NOT connected to the
// real Q-learning agent or the real ticker (see ticker.js for the real,
// unscripted replay data). Labeled "SAMPLE SEQUENCE" in the UI.
const HERO_ROUNDS = [
  { round: 1, stage: 'ask',        stageLabel: 'ASK',        seller: 60000, buyer: 42000 },
  { round: 2, stage: 'counter',    stageLabel: 'COUNTER',    seller: 55000, buyer: 46000 },
  { round: 3, stage: 'concession', stageLabel: 'CONCESSION', seller: 52000, buyer: 49000 },
  { round: 4, stage: 'deal',       stageLabel: 'DEAL',       seller: 50000, buyer: 49500 },
];

const heroStage = document.getElementById('heroPreviewStage');
const heroStatusDot = document.getElementById('heroStatusDot');
const heroStatusText = document.getElementById('heroStatusText');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmtUsd(n){
  return '$' + n.toLocaleString('en-US');
}

function heroRow(r){
  const row = document.createElement('div');
  row.className = 'round-row ticker-row hero-round';
  row.innerHTML = `
    <span class="hero-stage-tag ${r.stage}">${r.stageLabel}</span>
    <div class="round-badge">${r.round}</div>
    <div class="side seller-side"><div class="label">Seller ask</div><div class="value">${fmtUsd(r.seller)}</div></div>
    <div class="arrow">⇌</div>
    <div class="side buyer-side"><div class="label">Buyer offer</div><div class="value">${fmtUsd(r.buyer)}</div></div>
  `;
  return row;
}

function setHeroStatus(closed){
  if (!heroStatusDot || !heroStatusText) return;
  if (closed){
    heroStatusDot.classList.add('deal-closed');
    heroStatusText.textContent = '✓ DEAL CLOSED';
  } else {
    heroStatusDot.classList.remove('deal-closed');
    heroStatusText.textContent = '● NEGOTIATING';
  }
}

function playHeroSequenceOnce(onDone){
  heroStage.innerHTML = '';
  setHeroStatus(false);
  let i = 0;
  function next(){
    heroStage.appendChild(heroRow(HERO_ROUNDS[i]));
    heroStage.scrollTop = heroStage.scrollHeight;
    i++;
    if (i < HERO_ROUNDS.length){
      setTimeout(next, 700);
    } else {
      setTimeout(() => {
        setHeroStatus(true);
        setTimeout(onDone, 2400);
      }, 550);
    }
  }
  next();
}

function loopHeroSequence(){
  playHeroSequenceOnce(() => setTimeout(loopHeroSequence, 500));
}

if (heroStage){
  if (prefersReducedMotion){
    HERO_ROUNDS.forEach(r => heroStage.appendChild(heroRow(r)));
    setHeroStatus(true);
  } else {
    loopHeroSequence();
  }
}
