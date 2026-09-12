const startPanel = document.getElementById("start-panel");
const gamePanel = document.getElementById("game-panel");
const startBtn = document.getElementById("start-btn");
const sendBtn = document.getElementById("send-btn");
const newBtn = document.getElementById("new-btn");
const askInput = document.getElementById("ask-input");
const offerForm = document.getElementById("offer-form");
const errorMsg = document.getElementById("error-msg");
const outcomeBanner = document.getElementById("outcome-banner");
const logList = document.getElementById("log-list");

const sellerMinEl = document.getElementById("seller-min");
const roundNumEl = document.getElementById("round-num");
const buyerOfferEl = document.getElementById("buyer-offer");

function resetUI() {
  offerForm.classList.remove("hidden");
  newBtn.classList.add("hidden");
  outcomeBanner.classList.add("hidden");
  outcomeBanner.className = "outcome hidden";
  errorMsg.classList.add("hidden");
  logList.innerHTML = "";
  askInput.value = "";
  sendBtn.disabled = false;
}

function addLogEntry(text, round) {
  const li = document.createElement("li");
  const roundSpan = document.createElement("span");
  roundSpan.className = "log-round";
  roundSpan.textContent = round != null ? `Round ${round}` : "";
  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  li.appendChild(roundSpan);
  li.appendChild(textSpan);
  logList.appendChild(li);
  logList.scrollTop = logList.scrollHeight;
}

function showOutcome(data) {
  outcomeBanner.classList.remove("hidden");
  offerForm.classList.add("hidden");
  newBtn.classList.remove("hidden");

  let text;
  if (data.outcome === "deal") {
    outcomeBanner.className = "outcome deal";
    text = `Deal closed at ${data.deal_price}! (Buyer's true max was ${data.buyer_max})`;
  } else if (data.outcome === "walk") {
    outcomeBanner.className = "outcome walk";
    text = `The buyer walked away. (Buyer's true max was ${data.buyer_max})`;
  } else {
    outcomeBanner.className = "outcome timeout";
    text = `Negotiation timed out after ${data.round} rounds with no deal. (Buyer's true max was ${data.buyer_max})`;
  }
  outcomeBanner.textContent = text;
  addLogEntry(text, data.round);
}

function updateGameState(data) {
  roundNumEl.textContent = data.round;
  buyerOfferEl.textContent = data.buyer_offer;

  if (data.done) {
    showOutcome(data);
  }
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    const res = await fetch("/api/new_negotiation", { method: "POST" });
    const data = await res.json();

    sellerMinEl.textContent = data.seller_min;
    roundNumEl.textContent = data.round;
    buyerOfferEl.textContent = data.buyer_offer;

    resetUI();
    startPanel.classList.add("hidden");
    gamePanel.classList.remove("hidden");
    askInput.focus();
  } catch (err) {
    alert("Could not start a new negotiation. Is the server running?");
  } finally {
    startBtn.disabled = false;
  }
});

sendBtn.addEventListener("click", async () => {
  const ask = parseFloat(askInput.value);
  if (Number.isNaN(ask)) {
    errorMsg.textContent = "Enter a valid asking price.";
    errorMsg.classList.remove("hidden");
    return;
  }

  errorMsg.classList.add("hidden");
  sendBtn.disabled = true;

  try {
    const res = await fetch("/api/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ask }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorMsg.textContent = data.error || "Something went wrong.";
      errorMsg.classList.remove("hidden");
      return;
    }

    addLogEntry(
      `You asked ${ask.toFixed(1)} → buyer countered ${data.buyer_offer}`,
      data.round
    );
    askInput.value = "";
    updateGameState(data);
  } catch (err) {
    errorMsg.textContent = "Could not reach the server.";
    errorMsg.classList.remove("hidden");
  } finally {
    sendBtn.disabled = false;
  }
});

askInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

newBtn.addEventListener("click", () => {
  gamePanel.classList.add("hidden");
  startPanel.classList.remove("hidden");
});
