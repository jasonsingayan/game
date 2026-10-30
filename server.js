const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const rooms = new Map();
const GAME_LENGTH = 20;
const ROUND_SECONDS = 60;

// Familiar expressions, each four to six words long.
const PHRASES = [
  "Better late than never",
  "Actions speak louder than words",
  "The early bird catches the worm",
  "A watched pot never boils",
  "Every cloud has a silver lining",
  "Time flies when you're having fun",
  "Birds of a feather flock together",
  "Two heads are better than one",
  "All that glitters is not gold",
  "Look before you leap",
  "The grass is always greener",
  "Don't bite the hand that feeds",
  "Home is where the heart is",
  "Laughter is the best medicine",
  "Make hay while the sun shines",
  "A stitch in time saves nine",
  "You reap what you sow",
  "Easy come easy go",
  "Fortune favors the bold",
  "No pain no gain"
];

function randomCode() {
  let code;
  do {
    code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makeId() {
  return randomBytes(24).toString("hex");
}

function normalizeAnswer(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isLetterOrDigit(char) {
  return /[\p{L}\p{N}]/u.test(char);
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error("Request is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function beginRound(room, phraseIndex) {
  const phrase = PHRASES[phraseIndex];
  const revealOrder = [...phrase]
    .map((char, index) => isLetterOrDigit(char) ? index : -1)
    .filter(index => index >= 0);

  room.phraseIndex = phraseIndex;
  room.currentRound = {
    status: "active",
    startedAt: Date.now(),
    deadlineAt: Date.now() + ROUND_SECONDS * 1000,
    revealOrder,
    revealedCount: 0,
    closedReason: null,
    winners: []
  };
}

function closeRound(room, reason) {
  if (!room.currentRound || room.currentRound.status !== "active") return;
  room.currentRound.status = "closed";
  room.currentRound.closedReason = reason;
  room.currentRound.revealedCount = room.currentRound.revealOrder.length;
}

function refreshRound(room) {
  if (room.phase === "playing" && room.currentRound?.status === "active" && Date.now() >= room.currentRound.deadlineAt) {
    closeRound(room, "time");
  }
}

function scoresFor(room) {
  return Object.entries(room.players)
    .map(([id, player]) => ({ id, name: player.name, score: player.score, joinedAt: player.joinedAt }))
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
}

function makePublicState(room, hostToken, playerToken) {
  refreshRound(room);
  const isHost = Boolean(hostToken && hostToken === room.hostToken);
  const playerEntry = Object.entries(room.players).find(([, player]) => player.token === playerToken);
  const round = room.currentRound;
  let displayWords = [];
  let winners = [];
  let secondsRemaining = 0;

  if (round) {
    const phrase = PHRASES[room.phraseIndex];
    const revealed = new Set(round.revealOrder.slice(0, round.revealedCount));
    let position = 0;
    displayWords = phrase.split(" ").map((word, wordIndex, allWords) => {
      const cells = [...word].map(char => {
        const index = position++;
        const visible = !isLetterOrDigit(char) || revealed.has(index);
        return { visible, char: visible ? char : null };
      });
      if (wordIndex < allWords.length - 1) position += 1;
      return cells;
    });
    winners = round.winners.map(winner => ({
      name: room.players[winner.playerId]?.name || "Player",
      place: winner.place,
      points: winner.points
    }));
    if (round.status === "active") {
      secondsRemaining = Math.max(0, Math.ceil((round.deadlineAt - Date.now()) / 1000));
    }
  }

  const players = scoresFor(room).map(({ id, name, score }) => ({ id, name, score }));
  const currentPlayer = playerEntry ? {
    id: playerEntry[0],
    name: playerEntry[1].name,
    score: playerEntry[1].score,
    place: round?.winners.find(winner => winner.playerId === playerEntry[0])?.place || null
  } : null;

  return {
    code: room.code,
    phase: room.phase,
    isHost,
    musicEnabled: room.musicEnabled,
    playerCount: players.length,
    players,
    currentPlayer,
    round: round ? {
      number: room.phraseIndex + 1,
      total: GAME_LENGTH,
      status: round.status,
      secondsRemaining,
      revealedCount: round.revealedCount,
      revealTotal: round.revealOrder.length,
      displayWords,
      winners,
      closedReason: round.closedReason,
      solution: isHost ? PHRASES[room.phraseIndex] : undefined
    } : null,
    topThree: room.phase === "finished" ? players.slice(0, 3) : null
  };
}

function requireRoom(code) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return null;
  refreshRound(room);
  return room;
}

async function handleApi(request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const code = randomCode();
    const room = {
      code,
      hostToken: makeId(),
      phase: "lobby",
      musicEnabled: true,
      phraseIndex: -1,
      currentRound: null,
      players: {}
    };
    rooms.set(code, room);
    return sendJson(response, 201, { code, hostToken: room.hostToken });
  }

  if (segments.length < 3 || segments[0] !== "api" || segments[1] !== "rooms") {
    return sendJson(response, 404, { error: "Not found." });
  }

  const room = requireRoom(segments[2]);
  if (!room) return sendJson(response, 404, { error: "That room could not be found. Ask the host for a fresh link." });
  const action = segments[3];

  if (request.method === "GET" && action === "state") {
    return sendJson(response, 200, makePublicState(room, request.headers["x-host-token"], request.headers["x-player-token"]));
  }

  if (request.method === "POST" && action === "join") {
    const body = await readBody(request);
    const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 20);
    if (name.length < 1) return sendJson(response, 400, { error: "Enter a name to join." });

    const token = String(body.playerToken || "");
    const existing = Object.entries(room.players).find(([, player]) => player.token === token && token.length > 0);
    if (existing) {
      existing[1].name = name;
      return sendJson(response, 200, { playerToken: existing[1].token, playerId: existing[0], name });
    }
    if (Object.keys(room.players).length >= 200) return sendJson(response, 403, { error: "This room has reached its player limit." });
    if (Object.values(room.players).some(player => player.name.toLowerCase() === name.toLowerCase())) {
      return sendJson(response, 409, { error: "That name is already in this room. Try adding an initial." });
    }

    const playerId = makeId();
    const playerToken = makeId();
    room.players[playerId] = { token: playerToken, name, score: 0, joinedAt: Date.now() };
    return sendJson(response, 201, { playerToken, playerId, name });
  }

  if (request.method === "POST" && action === "guess") {
    const body = await readBody(request);
    refreshRound(room);
    const playerToken = String(body.playerToken || "");
    const playerEntry = Object.entries(room.players).find(([, player]) => player.token === playerToken && playerToken.length > 0);
    if (!playerEntry) return sendJson(response, 401, { error: "Join the room before guessing." });
    if (room.phase !== "playing" || room.currentRound?.status !== "active") {
      return sendJson(response, 409, { error: "This phrase is closed. Wait for the next one." });
    }

    const playerId = playerEntry[0];
    if (room.currentRound.winners.some(winner => winner.playerId === playerId)) {
      return sendJson(response, 409, { error: "You already scored on this phrase." });
    }
    if (normalizeAnswer(body.answer) !== normalizeAnswer(PHRASES[room.phraseIndex])) {
      return sendJson(response, 200, { result: "miss" });
    }

    const place = room.currentRound.winners.length + 1;
    const points = [100, 70, 50][place - 1];
    if (!points) return sendJson(response, 409, { error: "The three scoring spots have been claimed." });
    room.currentRound.winners.push({ playerId, place, points });
    playerEntry[1].score += points;
    if (room.currentRound.winners.length === 3) closeRound(room, "three-winners");
    return sendJson(response, 200, { result: "correct", place, points, name: playerEntry[1].name });
  }

  if (request.method === "POST" && action === "host") {
    const suppliedToken = request.headers["x-host-token"];
    if (!suppliedToken || suppliedToken !== room.hostToken) return sendJson(response, 403, { error: "Host controls are only available to the host." });
    const body = await readBody(request);
    const round = room.currentRound;

    if (body.action === "start") {
      if (room.phase !== "lobby") return sendJson(response, 409, { error: "This game has already started." });
      room.phase = "playing";
      beginRound(room, 0);
    } else if (body.action === "reveal") {
      if (room.phase !== "playing" || round?.status !== "active") return sendJson(response, 409, { error: "There is no active phrase to reveal." });
      round.revealedCount += 1;
      if (round.revealedCount >= round.revealOrder.length) closeRound(room, "revealed");
    } else if (body.action === "endRound") {
      if (room.phase !== "playing" || round?.status !== "active") return sendJson(response, 409, { error: "There is no active phrase to end." });
      closeRound(room, "host");
    } else if (body.action === "next") {
      if (room.phase !== "playing" || round?.status !== "closed") return sendJson(response, 409, { error: "Finish the current phrase before advancing." });
      if (room.phraseIndex + 1 >= GAME_LENGTH) {
        room.phase = "finished";
      } else {
        beginRound(room, room.phraseIndex + 1);
      }
    } else if (body.action === "music") {
      room.musicEnabled = Boolean(body.enabled);
    } else {
      return sendJson(response, 400, { error: "Unknown host action." });
    }
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "Not found." });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

function serveFile(request, response, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.resolve(ROOT, `.${requested}`);
  if (!safePath.startsWith(ROOT + path.sep) || !["index.html", "app.js", "styles.css"].includes(path.basename(safePath))) {
    response.writeHead(404);
    return response.end("Not found");
  }
  fs.readFile(safePath, (error, contents) => {
    if (error) {
      response.writeHead(404);
      return response.end("Not found");
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(safePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET") {
      serveFile(request, response, url);
    } else {
      sendJson(response, 405, { error: "Method not allowed." });
    }
  } catch (error) {
    if (!response.headersSent) sendJson(response, 400, { error: error.message || "Something went wrong." });
    else response.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Phrase Rush is ready at http://localhost:${PORT}`);
});
