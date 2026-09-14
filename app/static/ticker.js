// Real transcripts from manual testing sessions with the trained v3 agent.
const TRANSCRIPTS = [
  {
    label: "Hold-firm style — deal reached",
    rounds: [
      {round:1, ask:65.0, offer:45.9}, {round:2, ask:65.0, offer:45.9},
      {round:3, ask:65.0, offer:51.8}, {round:4, ask:65.0, offer:71.8},
      {round:5, ask:65.0, offer:73.8}, {round:6, ask:65.0, offer:80.7},
      {round:7, ask:65.0, offer:82.2}, {round:8, ask:65.0, offer:84.8},
      {round:9, ask:65.0, offer:85.2},
    ],
    outcome: {type:"deal", text:"Deal closed at 85.2"}
  },
  {
    label: "Anchored-low style — deal reached",
    rounds: [
      {round:1, ask:83.0, offer:61.0}, {round:2, ask:81.0, offer:61.0},
      {round:3, ask:79.0, offer:61.0}, {round:4, ask:75.0, offer:63.1},
      {round:5, ask:73.0, offer:69.0}, {round:6, ask:71.5, offer:71.1},
      {round:7, ask:71.1, offer:71.1},
    ],
    outcome: {type:"deal", text:"Deal closed at 71.1"}
  },
  {
    label: "No overlap in reservation prices — buyer walks",
    rounds: [
      {round:1, ask:143.0, offer:45.3}, {round:2, ask:137.0, offer:59.0},
      {round:3, ask:129.0, offer:69.5}, {round:4, ask:125.0, offer:70.3},
      {round:5, ask:120.0, offer:70.3}, {round:6, ask:118.0, offer:70.3},
    ],
    outcome: {type:"walk", text:"Buyer walked away — no possible deal"}
  },
];

const stage = document.getElementById('tickerStage');
let tIndex = 0;

function playTranscript(transcript){
  stage.innerHTML = `<div class="ticker-scenario-label">${transcript.label}</div><div class="ticker-rows" id="tickerRows"></div>`;
  const rowsEl = document.getElementById('tickerRows');
  let rIndex = 0;

  function nextRow(){
    if (rIndex < transcript.rounds.length){
      const r = transcript.rounds[rIndex];
      const row = document.createElement('div');
      row.className = 'round-row ticker-row';
      row.innerHTML = `
        <div class="round-badge">${r.round}</div>
        <div class="side seller-side"><div class="label">Ask</div><div class="value">${r.ask.toFixed(1)}</div></div>
        <div class="arrow">⇌</div>
        <div class="side buyer-side"><div class="label">Offer</div><div class="value">${r.offer.toFixed(1)}</div></div>
      `;
      rowsEl.appendChild(row);
      rowsEl.scrollTop = rowsEl.scrollHeight;
      rIndex++;
      setTimeout(nextRow, 550);
    } else {
      const outcomeEl = document.createElement('div');
      outcomeEl.className = `msg status ${transcript.outcome.type}`;
      outcomeEl.textContent = transcript.outcome.text;
      rowsEl.appendChild(outcomeEl);
      setTimeout(()=>{
        tIndex = (tIndex + 1) % TRANSCRIPTS.length;
        playTranscript(TRANSCRIPTS[tIndex]);
      }, 2600);
    }
  }
  nextRow();
}

playTranscript(TRANSCRIPTS[tIndex]);
