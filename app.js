const app = document.getElementById("app");
const toast = document.getElementById("toast");
const query = new URLSearchParams(window.location.search);
let roomCode = (query.get("room") || "").toUpperCase();
let hostToken = roomCode ? localStorage.getItem(`phrase-rush-host:${roomCode}`) : null;
let playerToken = roomCode ? localStorage.getItem(`phrase-rush-player:${roomCode}`) : null;
let state = null;
let currentView = "";
let draftAnswer = "";
let lastRoundNumber = null;
let guessPending = false;
let musicMuted = false;
let audioContext = null;
let musicGain = null;
let musicTimer = null;
let musicStep = 0;
let toastTimer = null;
let polling = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (hostToken) headers["X-Host-Token"] = hostToken;
  if (playerToken) headers["X-Player-Token"] = playerToken;
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
  return body;
}

function shellHeader({ room = false, host = false } = {}) {
  return `
    <header class="topbar">
      <a class="brand" href="/" aria-label="Phrase Rush home">
        <span class="brand-mark" aria-hidden="true">✦</span>
        <span class="brand-name">phrase<span>rush</span></span>
      </a>
      ${room ? `
        <div class="room-tools">
          <span class="room-code"><span class="live-dot"></span> ROOM ${escapeHtml(roomCode)}</span>
          <button class="quiet-button invite-button" data-action="copy-link" type="button">Copy invite link</button>
          <button class="quiet-button music-button" id="music-button" data-action="music" type="button" aria-label="Toggle background music"></button>
        </div>
      ` : `<span class="top-note"><span class="live-dot"></span> THE LIVE PHRASE GAME</span>`}
    </header>
  `;
}

function hostLobbyTemplate() {
  return `${shellHeader({ room: true, host: true })}
    <main class="host-lobby page-width">
      <div class="lobby-copy">
        <div class="eyebrow"><span class="eyebrow-line"></span> HOST CONTROL ROOM</div>
        <h1>Your room is<br><span>ready to play.</span></h1>
        <p class="lede">Send the invite to your players. When everyone is in, start the clock and let the guesses fly.</p>
        <div class="invite-card glass-card">
          <div class="card-heading"><div><span class="tiny-label">YOUR PRIVATE ROOM LINK</span><h2>Bring everyone in</h2></div><span class="invite-icon">↗</span></div>
          <div class="link-row"><input id="invite-link" aria-label="Room invite link" readonly><button class="copy-square" data-action="copy-link" aria-label="Copy invite link" type="button">⧉</button></div>
          <button class="primary-button start-game-button" id="start-game" data-action="host-start" type="button"><span>Start the game</span><span class="button-arrow">→</span></button>
          <div class="fine-print"><span class="live-dot"></span><span id="lobby-count">Waiting for players…</span></div>
        </div>
      </div>
      <aside class="lobby-side">
        <div class="side-card glass-card guest-card">
          <div class="card-heading"><div><span class="tiny-label">IN YOUR ROOM</span><h2><span id="guest-count">0</span> players</h2></div><div class="people-icon" aria-hidden="true">♧</div></div>
          <div id="lobby-player-list" class="player-list empty-list"><p>Names will show up here as people join.</p></div>
        </div>
        <div class="side-card glass-card rules-card">
          <span class="tiny-label">QUICK ROUND GUIDE</span>
          <div class="guide-row"><span class="guide-number">01</span><p>Players guess a familiar phrase in <b>60 seconds.</b></p></div>
          <div class="guide-row"><span class="guide-number">02</span><p>Reveal letters one at a time whenever you’re ready.</p></div>
          <div class="guide-row"><span class="guide-number">03</span><p>Fastest three correct guesses win <b>100 · 70 · 50 pts.</b></p></div>
          <div class="game-length"><span>20 PHRASES</span><span class="length-dots" aria-hidden="true">••••••</span></div>
        </div>
      </aside>
    </main>`;
}

function hostGameTemplate() {
  return `${shellHeader({ room: true, host: true })}
    <main class="page-width game-page">
      <div class="game-topline"><div><div class="eyebrow"><span class="eyebrow-line"></span> HOST CONTROL ROOM</div><h1 class="page-heading">Keep the room <span>guessing.</span></h1></div><div class="round-counter" id="round-counter">PHRASE <b>01</b> / 20</div></div>
      <div class="round-progress" id="round-progress" aria-label="Game progress"></div>
      <div class="game-layout">
        <section class="play-column">
          <div class="timer-row"><div><span class="tiny-label">ON THE CLOCK</span><div class="timer-caption" id="timer-caption">Players are ready</div></div><div class="timer-wrap"><span id="timer-number">60</span><span class="timer-unit">SEC</span></div></div>
          <div class="timer-track"><div id="timer-fill" class="timer-fill"></div></div>
          <section class="board-card" aria-label="Phrase board">
            <div class="board-topline"><span class="board-label">THE PHRASE</span><span class="board-mode" id="board-mode">WAITING FOR THE HOST</span></div>
            <div class="phrase-board" id="phrase-board"><div class="waiting-board"><span class="waiting-spark">✦</span><span>Your first phrase is on its way</span></div></div>
            <div class="board-bottomline"><span>FAMILIAR PHRASES · 4–6 WORDS</span><span id="letters-left">20 PHRASES IN THE BAG</span></div>
          </section>
          <section class="host-answer glass-card"><div><span class="tiny-label">HOST ONLY · ANSWER</span><b id="host-answer">Your first phrase will appear here.</b></div><span class="private-lock">NOT SHARED WITH PLAYERS</span></section>
          <section class="host-controls glass-card">
            <div class="control-copy"><span class="tiny-label">YOUR MOVE</span><h2 id="host-prompt">The spotlight is yours.</h2><p id="host-hint">Start the game when your players are ready.</p></div>
            <div class="control-actions" id="host-actions"></div>
          </section>
        </section>
        <aside class="score-column">
          <section class="glass-card score-card"><div class="card-heading"><div><span class="tiny-label">THIS PHRASE</span><h2>First to get it</h2></div><span class="trophy-icon">♛</span></div><div id="round-podium" class="round-podium"></div></section>
          <section class="glass-card score-card overall-card"><div class="card-heading"><div><span class="tiny-label">OVERALL STANDINGS</span><h2>Scoreboard</h2></div><span class="tiny-total" id="score-player-count">0 PLAYERS</span></div><div id="scoreboard" class="scoreboard"></div></section>
          <div class="host-tip"><span>✦</span><p>Give the room a beat after each reveal. The first three correct guesses score.</p></div>
        </aside>
      </div>
    </main>`;
}

function finishedTemplate(host) {
  return `${shellHeader({ room: true, host })}
    <main class="page-width final-page">
      <div class="final-kicker"><span class="final-stars">✦ &nbsp; ✦ &nbsp; ✦</span><span class="eyebrow">20 PHRASES. ONE FINAL PODIUM.</span></div>
      <h1 class="final-title">That’s a <span>wrap.</span></h1>
      <p class="final-subtitle">The room has spoken. Here are your Phrase Rush champions.</p>
      <div id="final-podium" class="final-podium"></div>
      <section class="final-scores glass-card"><div class="card-heading"><div><span class="tiny-label">FULL SCOREBOARD</span><h2>Every point counts</h2></div><span class="tiny-total" id="final-player-count"></span></div><div id="final-scoreboard" class="scoreboard"></div></section>
      <p class="final-footnote">Thanks for playing <span>phrase rush.</span></p>
    </main>`;
}

function participantJoinTemplate() {
  return `${shellHeader({ room: true })}
    <main class="join-page page-width">
      <div class="join-card glass-card">
        <div class="join-spark">✦</div><div class="eyebrow"><span class="eyebrow-line"></span> YOU’RE INVITED</div>
        <h1>Ready to<br><span>say it first?</span></h1>
        <p class="lede">Join the room, watch the letters appear, and be quick on the guess.</p>
        <form id="join-form" class="join-form"><label for="player-name">What should we call you?</label><input id="player-name" name="name" maxlength="20" autocomplete="name" placeholder="Your name" required><button class="primary-button" type="submit"><span>Join the room</span><span class="button-arrow">→</span></button><p id="join-error" class="form-error" role="alert"></p></form>
        <div class="join-room-status"><span class="live-dot"></span><span id="join-player-count">Connecting to room…</span><span class="status-divider">·</span>20 phrases · 60 seconds each</div>
      </div>
      <div class="join-points"><span>GUESS FAST. SCORE BIG.</span><div><b>100</b><i>1st</i><b>70</b><i>2nd</i><b>50</b><i>3rd</i></div></div>
    </main>`;
}

function participantWaitTemplate() {
  return `${shellHeader({ room: true })}
    <main class="wait-page page-width"><div class="wait-card glass-card"><span class="wait-orbit">✦</span><div class="eyebrow">YOU’RE IN THE ROOM</div><h1>Eyes up,<br><span id="wait-name">player.</span></h1><p class="lede">The host will start the first phrase in a moment. Get ready to type fast.</p><div class="wait-players"><span class="live-dot"></span><span id="wait-player-count">0 players are here</span></div><div class="wait-rule"><span>100</span> for first &nbsp;·&nbsp; <span>70</span> for second &nbsp;·&nbsp; <span>50</span> for third</div></div></main>`;
}

function participantGameTemplate() {
  return `${shellHeader({ room: true })}
    <main class="page-width game-page player-page">
      <div class="game-topline"><div><div class="eyebrow"><span class="eyebrow-line"></span> YOU’RE PLAYING <b id="player-room-name"></b></div><h1 class="page-heading">Can you <span>say it first?</span></h1></div><div class="round-counter" id="round-counter">PHRASE <b>01</b> / 20</div></div>
      <div class="round-progress" id="round-progress" aria-label="Game progress"></div>
      <div class="game-layout player-game-layout">
        <section class="play-column">
          <div class="timer-row player-timer-row"><div><span class="tiny-label">TIME TO GUESS</span><div class="timer-caption" id="timer-caption">The host is getting ready</div></div><div class="timer-wrap"><span id="timer-number">60</span><span class="timer-unit">SEC</span></div></div>
          <div class="timer-track"><div id="timer-fill" class="timer-fill"></div></div>
          <section class="board-card player-board-card" aria-label="Phrase board"><div class="board-topline"><span class="board-label">GUESS THE PHRASE</span><span class="board-mode" id="board-mode">WAITING FOR THE HOST</span></div><div class="phrase-board" id="phrase-board"><div class="waiting-board"><span class="waiting-spark">✦</span><span>Stay sharp. It could be anything familiar.</span></div></div><div class="board-bottomline"><span>ONE LETTER AT A TIME</span><span id="letters-left">20 PHRASES</span></div></section>
          <form id="guess-form" class="guess-form glass-card"><label for="guess-input"><span class="guess-icon">↳</span>Your guess</label><div class="guess-input-row"><input id="guess-input" name="answer" autocomplete="off" autocapitalize="off" placeholder="Type the whole phrase…" maxlength="120" required><button class="primary-button guess-button" type="submit"><span>Lock it in</span><span class="button-arrow">→</span></button></div><p id="guess-feedback" class="guess-feedback" aria-live="polite"></p></form>
          <div class="player-round-message" id="player-round-message" hidden></div>
        </section>
        <aside class="score-column player-score-column">
          <section class="glass-card score-card"><div class="card-heading"><div><span class="tiny-label">THIS PHRASE</span><h2>First to get it</h2></div><span class="trophy-icon">♛</span></div><div id="round-podium" class="round-podium"></div></section>
          <section class="glass-card score-card overall-card"><div class="card-heading"><div><span class="tiny-label">YOUR POINTS</span><h2 id="my-score-heading">Scoreboard</h2></div><span class="tiny-total" id="score-player-count">0 PLAYERS</span></div><div id="scoreboard" class="scoreboard"></div></section>
          <div class="host-tip player-tip"><span>✦</span><p>First three correct guesses score. Case and punctuation don’t matter.</p></div>
        </aside>
      </div>
    </main>`;
}

function landingTemplate() {
  return `${shellHeader()}
    <main class="landing-page page-width"><section class="landing-copy"><div class="eyebrow"><span class="eyebrow-line"></span> A LIVE GAME FOR YOUR PEOPLE</div><h1>Say it<br><span>before it shows.</span></h1><p class="lede">Twenty familiar phrases. Sixty seconds on the clock. One host, a room full of players, and three chances to score.</p><button class="primary-button create-room-button" data-action="create-room" type="button"><span>Create a game room</span><span class="button-arrow">→</span></button><div class="landing-meta"><span>✦&nbsp; Host-led</span><span>✦&nbsp; 20 phrases</span><span>✦&nbsp; No player accounts</span></div></section><section class="landing-art" aria-hidden="true"><div class="art-orbit orbit-large"></div><div class="art-orbit orbit-small"></div><div class="art-card art-card-back"><span>TIME FLIES WHEN</span><span>YOU’RE HAVING FUN</span></div><div class="art-card art-card-front"><span class="art-tag">YOUR NEXT PHRASE</span><div class="art-tiles"><i>_</i><i>_</i><i>A</i><i>_</i><i>_</i></div><div class="art-tiles second-tiles"><i>_</i><i>_</i><i>_</i><i>E</i><i>_</i></div><span class="art-timer">00:60 <small>LEFT</small></span></div><span class="art-spark spark-one">✦</span><span class="art-spark spark-two">✧</span><div class="art-score"><span>1ST PLACE</span><b>+100</b><i>pts</i></div></section></main>
    <footer class="landing-footer"><span>PHRASE RUSH</span><span>GUESS FAST. HAVE FUN.</span></footer>`;
}

function errorTemplate(message) {
  return `${shellHeader()}<main class="error-page page-width"><div class="error-card glass-card"><span class="error-symbol">!</span><div class="eyebrow">ROOM UNAVAILABLE</div><h1>We can’t find<br><span>this room.</span></h1><p class="lede">${escapeHtml(message)}</p><a class="primary-button link-button" href="/"><span>Back to Phrase Rush</span><span class="button-arrow">→</span></a></div></main>`;
}

function viewFor(nextState) {
  if (!roomCode) return "landing";
  if (!nextState) return "loading";
  if (nextState.isHost) return nextState.phase === "lobby" ? "host-lobby" : nextState.phase === "finished" ? "host-finished" : "host-game";
  if (!nextState.currentPlayer) return "player-join";
  if (nextState.phase === "lobby") return "player-wait";
  if (nextState.phase === "finished") return "player-finished";
  return "player-game";
}

function templateFor(view) {
  if (view === "landing") return landingTemplate();
  if (view === "host-lobby") return hostLobbyTemplate();
  if (view === "host-game") return hostGameTemplate();
  if (view === "host-finished") return finishedTemplate(true);
  if (view === "player-join") return participantJoinTemplate();
  if (view === "player-wait") return participantWaitTemplate();
  if (view === "player-game") return participantGameTemplate();
  if (view === "player-finished") return finishedTemplate(false);
  if (view === "error") return errorTemplate("Ask the host for a fresh room link and try again.");
  return `${shellHeader()}<main class="loading-page page-width"><div class="loading-pulse"><span></span><span></span><span></span></div><p>Setting the stage…</p></main>`;
}

function setView(view) {
  if (view === currentView) return;
  currentView = view;
  app.innerHTML = templateFor(view);
  if (view === "player-join" && state?.currentPlayer == null) {
    const nameInput = document.getElementById("player-name");
    if (nameInput) nameInput.focus({ preventScroll: true });
  }
  if (view === "player-game" && draftAnswer) {
    const input = document.getElementById("guess-input");
    if (input) input.value = draftAnswer;
  }
}

function getInviteLink() {
  return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomCode)}`;
}

function makePlayerRows(players, limit = 8, currentPlayerId = null) {
  if (!players?.length) return `<p class="empty-score">Players will appear here once they join.</p>`;
  return players.slice(0, limit).map((player, index) => `
    <div class="score-row ${player.id === currentPlayerId ? "is-you" : ""}">
      <span class="score-rank">${String(index + 1).padStart(2, "0")}</span><span class="score-name">${escapeHtml(player.name)}${player.id === currentPlayerId ? `<i>YOU</i>` : ""}</span><b class="score-value">${player.score}<small> pts</small></b>
    </div>`).join("");
}

function makeLobbyRows(players) {
  if (!players?.length) return `<p>Names will show up here as people join.</p>`;
  return players.map((player, index) => `<div class="lobby-player"><span class="player-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span><span>${escapeHtml(player.name)}</span><small>${index === 0 ? "READY" : "IN THE ROOM"}</small></div>`).join("");
}

function makeWinners(winners) {
  const slots = [1, 2, 3];
  const points = [100, 70, 50];
  const byPlace = new Map((winners || []).map(winner => [winner.place, winner]));
  return slots.map(place => {
    const winner = byPlace.get(place);
    return `<div class="podium-row ${winner ? `podium-place-${place}` : "podium-empty"}"><span class="podium-medal">${winner ? ["✦", "✧", "✧"][place - 1] : String(place).padStart(2, "0")}</span><span class="podium-name">${winner ? escapeHtml(winner.name) : "Waiting for a guess"}</span><b>${winner ? `+${winner.points}` : points[place - 1]}<small> pts</small></b></div>`;
  }).join("");
}

function makeBoard(words) {
  if (!words?.length) return `<div class="waiting-board"><span class="waiting-spark">✦</span><span>Your first phrase is on its way</span></div>`;
  return `<div class="word-row">${words.map(word => `<div class="word-group">${word.map(cell => `<span class="letter-tile ${cell.visible ? "revealed" : "covered"}" aria-hidden="true">${cell.visible ? escapeHtml(cell.char) : "&nbsp;"}</span>`).join("")}</div>`).join("")}</div>`;
}

function makeFinalPodium(players) {
  const winners = (players || []).slice(0, 3);
  const order = [winners[1], winners[0], winners[2]];
  const places = [2, 1, 3];
  return order.map((player, index) => `<div class="final-place final-place-${places[index]}"><span class="final-place-label">${places[index] === 1 ? "THE CHAMPION" : places[index] === 2 ? "RUNNER UP" : "THIRD PLACE"}</span><div class="final-avatar">${player ? escapeHtml(player.name.slice(0, 1).toUpperCase()) : "✦"}</div><b class="final-name">${player ? escapeHtml(player.name) : "—"}</b><span class="final-points">${player ? player.score : "0"}<small>PTS</small></span></div>`).join("");
}

function updateProgress(round) {
  const progress = document.getElementById("round-progress");
  if (!progress || !round) return;
  progress.innerHTML = Array.from({ length: round.total }, (_, index) => `<span class="progress-dot ${index < round.number - 1 ? "is-done" : index === round.number - 1 ? "is-current" : ""}" aria-label="Phrase ${index + 1}"></span>`).join("");
  const counter = document.getElementById("round-counter");
  if (counter) counter.innerHTML = round.number <= round.total ? `PHRASE <b>${String(round.number).padStart(2, "0")}</b> / ${round.total}` : `PHRASE <b>${round.total}</b> / ${round.total}`;
}

function updateTimer(round) {
  const timer = document.getElementById("timer-number");
  const fill = document.getElementById("timer-fill");
  const wrap = document.querySelector(".timer-wrap");
  const caption = document.getElementById("timer-caption");
  const remaining = round?.status === "active" ? round.secondsRemaining : 0;
  if (timer) timer.textContent = String(remaining).padStart(2, "0");
  if (fill) fill.style.width = `${round?.status === "active" ? Math.max(0, Math.min(100, (remaining / 60) * 100)) : 0}%`;
  if (wrap) wrap.classList.toggle("timer-critical", round?.status === "active" && remaining <= 10);
  if (caption) {
    if (!round) caption.textContent = "Players are ready";
    else if (round.status === "active") caption.textContent = remaining <= 10 ? "Final seconds — lock in" : "Make your guess count";
    else if (round.closedReason === "time") caption.textContent = "Time is up";
    else if (round.closedReason === "revealed") caption.textContent = "The whole phrase is out";
    else if (round.closedReason === "three-winners") caption.textContent = "Three spots, all claimed";
    else caption.textContent = "Phrase complete";
  }
}

function updateHostActions(round) {
  const actions = document.getElementById("host-actions");
  if (!actions) return;
  const prompt = document.getElementById("host-prompt");
  const hint = document.getElementById("host-hint");
  if (round?.status === "active") {
    if (prompt) prompt.textContent = "Reveal when you’re ready.";
    if (hint) hint.textContent = `${Math.max(0, round.revealTotal - round.revealedCount)} letters still hidden. You control the pace.`;
    actions.innerHTML = `<button class="primary-button reveal-button" data-action="host-reveal" type="button"><span>Reveal next letter</span><span class="reveal-key">✦</span></button><button class="text-button end-round-button" data-action="host-end" type="button">End this phrase</button>`;
  } else if (round?.status === "closed") {
    if (prompt) prompt.textContent = round.number === round.total ? "That was the last phrase." : "Ready for the next phrase?";
    if (hint) hint.textContent = round.number === round.total ? "Finish strong — reveal the final scoreboard." : "The next 60-second round starts as soon as you advance.";
    actions.innerHTML = `<button class="primary-button next-button" data-action="host-next" type="button"><span>${round.number === round.total ? "See the final scores" : "Next phrase"}</span><span class="button-arrow">→</span></button>`;
  } else {
    if (prompt) prompt.textContent = "The spotlight is yours.";
    if (hint) hint.textContent = "Start the game when your players are ready.";
    actions.innerHTML = `<button class="primary-button next-button" data-action="host-start" type="button"><span>Start the game</span><span class="button-arrow">→</span></button>`;
  }
}

function updateGame(state) {
  const round = state.round;
  updateProgress(round);
  updateTimer(round);
  const board = document.getElementById("phrase-board");
  if (board) board.innerHTML = makeBoard(round?.displayWords);
  const mode = document.getElementById("board-mode");
  if (mode) mode.textContent = round?.status === "active" ? "LETTERS REVEAL ONE BY ONE" : round ? "PHRASE REVEALED" : "WAITING FOR THE HOST";
  const letters = document.getElementById("letters-left");
  if (letters) letters.textContent = round?.status === "active" ? `${round.revealTotal - round.revealedCount} LETTERS HIDDEN` : `${state.players.length} PLAYERS IN THE ROOM`;
  const podium = document.getElementById("round-podium");
  if (podium) podium.innerHTML = makeWinners(round?.winners || []);
  const count = document.getElementById("score-player-count");
  if (count) count.textContent = `${state.players.length} PLAYER${state.players.length === 1 ? "" : "S"}`;
  const scores = document.getElementById("scoreboard");
  if (scores) scores.innerHTML = makePlayerRows(state.players, 8, state.currentPlayer?.id);

  if (currentView === "host-game") updateHostActions(round);
  if (currentView === "host-game") {
    const answer = document.getElementById("host-answer");
    if (answer) answer.textContent = round?.solution || "Your first phrase will appear here.";
  }
  if (currentView === "player-game") {
    const roomName = document.getElementById("player-room-name");
    if (roomName) roomName.textContent = state.currentPlayer?.name || "";
    const myScore = document.getElementById("my-score-heading");
    if (myScore) myScore.textContent = `${state.currentPlayer?.score || 0} points`;
    const form = document.getElementById("guess-form");
    const message = document.getElementById("player-round-message");
    const feedback = document.getElementById("guess-feedback");
    const input = document.getElementById("guess-input");
    const hasWon = Boolean(state.currentPlayer?.place);
    const open = round?.status === "active" && !hasWon;
    if (form) form.hidden = !open;
    if (message) {
      message.hidden = open;
      if (hasWon) {
        const place = state.currentPlayer.place;
        message.innerHTML = `<span class="success-mark">✦</span><b>You got it — ${place === 1 ? "first" : place === 2 ? "second" : "third"} place!</b><span>+${[100, 70, 50][place - 1]} points · Stay ready for the next one.</span>`;
      } else if (round?.status === "active") {
        message.innerHTML = `<b>The host is setting up the next phrase.</b><span>Keep your eyes on the board.</span>`;
      } else if (round?.status === "closed") {
        message.innerHTML = `<b>${round.closedReason === "time" ? "Time is up." : round.closedReason === "revealed" ? "The whole phrase is revealed." : round.closedReason === "three-winners" ? "All three scoring spots are claimed." : "This phrase is complete."}</b><span>Get ready for phrase ${Math.min(round.number + 1, round.total)}.</span>`;
      }
    }
    if (feedback && guessFeedbackText) feedback.textContent = guessFeedbackText;
    if (input) input.disabled = guessPending;
    if (round && round.number !== lastRoundNumber) {
      lastRoundNumber = round.number;
      guessFeedbackText = "";
      if (feedback) feedback.textContent = "";
      if (input) input.value = "";
      draftAnswer = "";
    }
  }
}

let guessFeedbackText = "";

function updateFinal(state) {
  const podium = document.getElementById("final-podium");
  if (podium) podium.innerHTML = makeFinalPodium(state.topThree || []);
  const scores = document.getElementById("final-scoreboard");
  if (scores) scores.innerHTML = makePlayerRows(state.players, Number.POSITIVE_INFINITY, null);
  const count = document.getElementById("final-player-count");
  if (count) count.textContent = `${state.players.length} PLAYER${state.players.length === 1 ? "" : "S"}`;
}

function syncMusic() {
  const button = document.getElementById("music-button");
  if (button) {
    if (state?.isHost) button.textContent = state.musicEnabled ? "♫ Music on" : "♫ Music off";
    else button.textContent = musicMuted ? "♫ Music muted" : state?.musicEnabled ? "♫ Music on" : "♫ Music off";
  }
  const shouldPlay = Boolean(state?.musicEnabled && !musicMuted);
  if (shouldPlay) startMusic();
  else stopMusic();
}

function syncState(nextState) {
  state = nextState;
  const view = viewFor(state);
  setView(view);
  syncMusic();

  if (view === "host-lobby") {
    const invite = document.getElementById("invite-link");
    if (invite) invite.value = getInviteLink();
    const count = document.getElementById("guest-count");
    if (count) count.textContent = String(state.playerCount);
    const lobbyCount = document.getElementById("lobby-count");
    if (lobbyCount) lobbyCount.textContent = state.playerCount ? `${state.playerCount} player${state.playerCount === 1 ? " is" : "s are"} in the room — you can start anytime.` : "Waiting for players…";
    const list = document.getElementById("lobby-player-list");
    if (list) {
      list.innerHTML = makeLobbyRows(state.players);
      list.classList.toggle("empty-list", state.players.length === 0);
    }
  } else if (view === "host-game" || view === "player-game") {
    updateGame(state);
  } else if (view === "player-join") {
    const count = document.getElementById("join-player-count");
    if (count) count.textContent = `${state.playerCount} player${state.playerCount === 1 ? "" : "s"} ${state.playerCount === 1 ? "is" : "are"} in this room`;
  } else if (view === "player-wait") {
    const name = document.getElementById("wait-name");
    const count = document.getElementById("wait-player-count");
    if (name) name.textContent = `${state.currentPlayer.name}.`;
    if (count) count.textContent = `${state.playerCount} player${state.playerCount === 1 ? " is" : "s are"} here`;
  } else if (view === "host-finished" || view === "player-finished") {
    updateFinal(state);
  }
}

function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!audioContext) {
    audioContext = new AudioContextClass();
    musicGain = audioContext.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function playSoftNote(frequency, startAt) {
  if (!audioContext || !musicGain || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(0.14, startAt + 0.16);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 2.1);
  oscillator.connect(envelope);
  envelope.connect(musicGain);
  oscillator.start(startAt);
  oscillator.stop(startAt + 2.15);
}

function startMusic() {
  unlockAudio();
  if (!audioContext || !musicGain) return;
  if (musicTimer) return;
  musicGain.gain.cancelScheduledValues(audioContext.currentTime);
  musicGain.gain.setTargetAtTime(0.19, audioContext.currentTime, 0.5);
  const notes = [261.63, 329.63, 392, 329.63, 293.66, 392, 440, 392];
  const playNext = () => {
    const now = audioContext.currentTime;
    const root = [130.81, 146.83, 164.81, 146.83][Math.floor(musicStep / 2) % 4];
    playSoftNote(notes[musicStep % notes.length], now);
    if (musicStep % 2 === 0) playSoftNote(root, now);
    musicStep += 1;
  };
  playNext();
  musicTimer = setInterval(playNext, 1800);
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  else return;
  musicTimer = null;
  if (audioContext && musicGain) {
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.18);
  }
}

async function refreshState() {
  if (!roomCode || polling) return;
  polling = true;
  try {
    const nextState = await api(`/api/rooms/${encodeURIComponent(roomCode)}/state`);
    syncState(nextState);
  } catch (error) {
    if (!state) {
      currentView = "";
      setView("error");
    } else if (!toast.classList.contains("visible")) {
      showToast(error.message);
    }
  } finally {
    polling = false;
  }
}

async function createRoom() {
  unlockAudio();
  try {
    const created = await api("/api/rooms", { method: "POST", body: "{}" });
    roomCode = created.code;
    hostToken = created.hostToken;
    localStorage.setItem(`phrase-rush-host:${roomCode}`, hostToken);
    window.history.pushState({}, "", `?room=${encodeURIComponent(roomCode)}`);
    await refreshState();
  } catch (error) {
    showToast(error.message);
  }
}

async function hostAction(action, extra = {}) {
  unlockAudio();
  try {
    await api(`/api/rooms/${encodeURIComponent(roomCode)}/host`, {
      method: "POST",
      body: JSON.stringify({ action, ...extra })
    });
    await refreshState();
  } catch (error) {
    showToast(error.message);
    await refreshState();
  }
}

async function copyInvite() {
  const link = getInviteLink();
  try {
    await navigator.clipboard.writeText(link);
    showToast("Invite link copied — send it to your players.");
  } catch {
    const helper = document.createElement("textarea");
    helper.value = link;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    showToast(copied ? "Invite link copied — send it to your players." : link);
  }
}

async function joinRoom(form) {
  unlockAudio();
  const name = new FormData(form).get("name");
  const errorNode = document.getElementById("join-error");
  if (errorNode) errorNode.textContent = "";
  try {
    const joined = await api(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
      method: "POST",
      body: JSON.stringify({ name, playerToken })
    });
    playerToken = joined.playerToken;
    localStorage.setItem(`phrase-rush-player:${roomCode}`, playerToken);
    await refreshState();
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
    else showToast(error.message);
  }
}

async function submitGuess(form) {
  if (guessPending) return;
  const answer = new FormData(form).get("answer");
  draftAnswer = String(answer || "");
  guessPending = true;
  const input = document.getElementById("guess-input");
  if (input) input.disabled = true;
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(roomCode)}/guess`, {
      method: "POST",
      body: JSON.stringify({ answer, playerToken })
    });
    if (result.result === "correct") {
      guessFeedbackText = `That’s right! You’re ${result.place === 1 ? "first" : result.place === 2 ? "second" : "third"} for +${result.points} points.`;
      draftAnswer = "";
    } else {
      guessFeedbackText = "Not quite. Take another look and try again.";
      draftAnswer = "";
    }
    const feedback = document.getElementById("guess-feedback");
    if (feedback) feedback.textContent = guessFeedbackText;
    form.reset();
    await refreshState();
  } catch (error) {
    guessFeedbackText = error.message;
    const feedback = document.getElementById("guess-feedback");
    if (feedback) feedback.textContent = error.message;
  } finally {
    guessPending = false;
    if (input) input.disabled = false;
  }
}

app.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "create-room") createRoom();
  else if (action === "copy-link") copyInvite();
  else if (action === "host-start") hostAction("start");
  else if (action === "host-reveal") hostAction("reveal");
  else if (action === "host-end") hostAction("endRound");
  else if (action === "host-next") hostAction("next");
  else if (action === "music") {
    unlockAudio();
    if (state?.isHost) hostAction("music", { enabled: !state.musicEnabled });
    else {
      musicMuted = !musicMuted;
      syncMusic();
    }
  }
});

app.addEventListener("submit", event => {
  if (event.target.id === "join-form") {
    event.preventDefault();
    joinRoom(event.target);
  } else if (event.target.id === "guess-form") {
    event.preventDefault();
    submitGuess(event.target);
  }
});

app.addEventListener("input", event => {
  if (event.target.id === "guess-input") draftAnswer = event.target.value;
});

if (!roomCode) {
  setView("landing");
} else {
  setView("loading");
  refreshState();
  setInterval(refreshState, 750);
}
