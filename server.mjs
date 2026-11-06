import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 3000);
const html = await readFile(new URL('./index.html', import.meta.url));
const httpServer = http.createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});
const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024, perMessageDeflate: false });
const rooms = new Map();
const names = ['AI', 'Crypto', 'Real Estate', 'Defense', 'Government', 'Medicine'];
const headlines = [
  { title: 'AI LABS UNVEIL A MODEL THAT CAN REASON', detail: 'A leap in machine intelligence sends investors racing toward the sector.', moves: [[0, 20], [4, 5]] },
  { title: 'DATA CENTERS HIT A POWER BOTTLENECK', detail: 'Grid constraints put a chill on the artificial intelligence trade.', moves: [[0, -15], [2, 5]] },
  { title: 'SPOT CRYPTO FUNDS SEE RECORD INFLOWS', detail: 'Institutional buyers pile into digital assets after a wave of new investment products.', moves: [[1, 20], [4, 5]] },
  { title: 'MAJOR EXCHANGE HALTS WITHDRAWALS', detail: 'A liquidity scare ripples through the crypto market and rattles risk assets.', moves: [[1, -25], [0, -5]] },
  { title: 'CENTRAL BANK SIGNALS A RATE CUT', detail: 'Cheaper borrowing lifts property valuations and improves the outlook for growth stocks.', moves: [[2, 15], [0, 5]] },
  { title: 'OFFICE VACANCIES REACH A NEW HIGH', detail: 'Landlords brace for falling rents as companies shrink their office footprints.', moves: [[2, -20]] },
  { title: 'BORDER CRISIS DRIVES NEW DEFENSE ORDERS', detail: 'Governments rush to replenish equipment and expand military contracts.', moves: [[3, 20], [4, 5]] },
  { title: 'CEASEFIRE FRAMEWORK GAINS SUPPORT', detail: 'The prospect of de-escalation cools demand for weapons and defense contracts.', moves: [[3, -15], [2, 5]] },
  { title: 'INFRASTRUCTURE PACKAGE CLEARS COMMITTEE', detail: 'A bipartisan spending deal sends public contractors higher.', moves: [[4, 15], [2, 5]] },
  { title: 'BUDGET STALEMATE THREATENS A SHUTDOWN', detail: 'Investors worry that federal contracts and public services could be delayed.', moves: [[4, -20], [3, 5]] },
  { title: 'NEW CANCER THERAPY POSTS STRONG RESULTS', detail: 'Early trial data raises hopes for a treatment with broad potential.', moves: [[5, 20], [0, 5]] },
  { title: 'SAFETY REVIEW PAUSES A BLOCKBUSTER DRUG', detail: 'Regulators request more data, putting a major medical launch on hold.', moves: [[5, -20]] },
  { title: 'A FAST-MOVING OUTBREAK CROSSES BORDERS', detail: 'Hospitals prepare for a surge while public agencies mobilize a response.', moves: [[5, 15], [4, 10], [2, -10]] },
  { title: 'QUANTUM BREAKTHROUGH PUTS ENCRYPTION AT RISK', detail: 'Digital asset exchanges and AI firms rush to assess their security exposure.', moves: [[1, -15], [0, -10], [5, 5]] },
  { title: 'INSURERS RETREAT FROM COASTAL MARKETS', detail: 'Higher premiums unsettle property owners and lenders in exposed regions.', moves: [[2, -15], [4, 5]] },
  { title: 'TRADE EMBARGO DISRUPTS WEAPONS SUPPLY', detail: 'Defense contractors face delays while officials search for replacement suppliers.', moves: [[3, -15], [4, 5]] },
  { title: 'COURT BLOCKS A SWEEPING TECH RULE', detail: 'Investors welcome a reprieve for AI developers and crypto platforms.', moves: [[0, 10], [1, 10]] },
  { title: 'MEDICARE EXPANSION WINS A FINAL VOTE', detail: 'A larger public health budget improves the outlook for medical suppliers.', moves: [[5, 15], [4, 5]] }
];
const freshPlayer = (name, id) => ({ id, name, cash: 500000, shares: Array(6).fill(0), online: true });

function publicState(room) {
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, round: room.round, max: room.max,
    turn: room.turn, turnId: room.players[room.turn]?.id ?? null,
    prices: room.prices, history: room.history, headline: room.headline, last: room.last, events: room.events.slice(0, 12),
    players: room.players.map(({ id, name, cash, shares, online }) => ({ id, name, cash, shares, online, ready: shares.some(Boolean) }))
  };
}
function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function broadcast(room) {
  for (const player of room.players) {
    const ws = player.socket;
    if (ws?.readyState === WebSocket.OPEN) send(ws, { type: 'state', state: publicState(room), isHost: player.id === room.hostId });
  }
}
function log(room, message) { room.events.unshift(message); room.events = room.events.slice(0, 12); }
function error(ws, message) { send(ws, { type: 'error', message }); }
function getPlayer(ws, m) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  if (!room || room !== ws.room) return [null, null];
  const player = room.players.find(p => p.id === ws.playerId);
  return [room, player];
}
function roomCode() {
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
}
function attach(ws, room, player, type) {
  ws.room = room; ws.playerId = player.id; player.socket = ws; player.online = true;
  send(ws, { type, roomCode: room.code, playerId: player.id, isHost: player.id === room.hostId });
  broadcast(room);
}
function addRoom(ws, m) {
  const name = String(m.name || '').trim().slice(0, 18);
  if (!name) return error(ws, 'Enter your name first.');
  const room = { code: roomCode(), hostId: '', phase: 'lobby', round: 0, max: [12,20,30].includes(Number(m.rounds)) ? Number(m.rounds) : 12, turn: 0, prices: Array(6).fill(100), history: Array.from({ length: 6 }, () => [100]), headline: null, last: '', events: [], players: [] };
  const player = freshPlayer(name, randomUUID()); room.hostId = player.id; room.players.push(player); rooms.set(room.code, room);
  attach(ws, room, player, 'created');
}
function joinRoom(ws, m) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  const name = String(m.name || '').trim().slice(0, 18);
  if (!room) return error(ws, 'That room code was not found.');
  if (!name) return error(ws, 'Enter your name first.');
  if (room.phase !== 'lobby') return error(ws, 'This game has already started.');
  if (room.players.length >= 6) return error(ws, 'This room is full.');
  const player = freshPlayer(name, randomUUID()); room.players.push(player); log(room, `${name} joined the room.`); attach(ws, room, player, 'joined');
}
function reconnect(ws, m) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  const player = room?.players.find(p => p.id === m.playerId);
  if (!room || !player) return error(ws, 'Room session not found. Return to the lobby and join again.');
  if (player.socket && player.socket !== ws && player.socket.readyState === WebSocket.OPEN) player.socket.close(4001, 'Reconnected elsewhere');
  attach(ws, room, player, 'reconnected');
}
function buySell(ws, m) {
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
  if (!['setup', 'trade'].includes(room.phase)) return error(ws, 'Trading is closed right now.');
  const stock = Number(m.stock), qty = Number(m.shares);
  if (!Number.isInteger(stock) || stock < 0 || stock >= 6 || !Number.isInteger(qty) || qty === 0 || Math.abs(qty) % 500 !== 0 || Math.abs(qty) > 10000) return error(ws, 'That trade is not valid.');
  const cost = qty * room.prices[stock];
  if (qty > 0 && player.cash < cost) return error(ws, 'Not enough cash for that purchase.');
  if (qty < 0 && player.shares[stock] < -qty) return error(ws, 'You do not own enough shares to sell that lot.');
  player.cash -= cost; player.shares[stock] += qty;
  log(room, `${player.name} ${qty > 0 ? 'bought' : 'sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])}.`);
  if (room.phase === 'setup' && room.players.every(p => p.shares.some(Boolean))) {
    room.phase = 'playing'; room.round = 1; room.turn = 0;
    room.last = 'Opening bell! Everyone is invested.'; log(room, 'The opening bell rang. The first player is up.');
  }
  broadcast(room);
}
function formatMoney(cents) { return '$' + (cents / 100).toFixed(2); }
function movePrice(room, stock, delta) {
  const before = room.prices[stock];
  room.prices[stock] += delta;
  let result = `${names[stock]} ${delta > 0 ? '+' : ''}${delta}¢ · ${formatMoney(before)} → ${formatMoney(room.prices[stock])}`;
  if (room.prices[stock] >= 200) {
    for (const player of room.players) player.shares[stock] *= 2;
    room.prices[stock] = 100;
    result += ' · split, shares doubled';
  } else if (room.prices[stock] <= 0) {
    for (const player of room.players) player.shares[stock] = 0;
    room.prices[stock] = 100;
    result += ' · crash, shares wiped out';
  }
  return result;
}
function applyHeadline(room) {
  const story = headlines[randomInt(headlines.length)];
  const impacts = story.moves.map(([stock, delta]) => movePrice(room, stock, delta));
  room.headline = { title: story.title, detail: story.detail, impacts, round: room.round };
  room.last = `Marketwire: ${story.title}`;
  log(room, `📰 ${story.title} — ${story.detail}`);
  impacts.forEach(impact => log(room, impact));
}
function recordHistory(room) {
  room.prices.forEach((price, i) => {
    room.history[i].push(price);
    if (room.history[i].length > 22) room.history[i].shift();
  });
}
function roll(ws, m) {
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
  if (room.phase !== 'playing') return error(ws, 'The market is not taking rolls right now.');
  const currentPlayer = room.players[room.turn];
  if (currentPlayer?.id !== player.id && !(player.id === room.hostId && currentPlayer && !currentPlayer.online)) return error(ws, 'Wait for your turn.');
  const stock = randomInt(6), action = ['up','up','down','down','dividend','dividend'][randomInt(6)], amount = [5,5,10,10,20,20][randomInt(6)];
  const stockName = names[stock];
  if (action === 'dividend') {
    let paid = 0;
    if (room.prices[stock] >= 100) for (const p of room.players) { const dividend = p.shares[stock] * amount; p.cash += dividend; paid += dividend; }
    room.last = `${stockName} dividend · ${amount}¢ per share${room.prices[stock] >= 100 ? ` · ${formatMoney(paid)} paid` : ' · below par, no payout'}.`;
    log(room, room.last);
  } else {
    const old = room.prices[stock]; room.prices[stock] += action === 'up' ? amount : -amount;
    let event = `${stockName} ${action} ${amount}¢: ${formatMoney(old)} → ${formatMoney(room.prices[stock])}`;
    if (room.prices[stock] >= 200) { for (const p of room.players) p.shares[stock] *= 2; room.prices[stock] = 100; event += ' · split; holdings doubled and price reset to par.'; }
    else if (room.prices[stock] <= 0) { for (const p of room.players) p.shares[stock] = 0; room.prices[stock] = 100; event += ' · crash; shares wiped out and price reset to par.'; }
    room.last = event; log(room, event);
  }
  room.turn++;
  if (room.turn >= room.players.length) {
    room.turn = 0;
    applyHeadline(room);
    recordHistory(room);
    if (room.round >= room.max) {
      room.phase = 'done'; room.players.sort((a,b) => netWorth(b, room) - netWorth(a, room));
      room.last = 'Closing bell! Final portfolios are ranked.'; log(room, room.last);
    } else { room.phase = 'trade'; room.last += ' Trading is now open.'; }
  } else recordHistory(room);
  broadcast(room);
}
function netWorth(p, room) { return p.cash + p.shares.reduce((sum, count, i) => sum + count * room.prices[i], 0); }
function handle(ws, m) {
  if (m.type === 'ping') return send(ws, { type: 'pong' });
  if (m.type === 'create') return addRoom(ws, m);
  if (m.type === 'join') return joinRoom(ws, m);
  if (m.type === 'reconnect') return reconnect(ws, m);
  if (m.type === 'start') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the room host can start the game.');
    if (room.phase !== 'lobby') return error(ws, 'The game has already started.');
    if (room.players.length < 2) return error(ws, 'At least two players are needed.');
    room.phase = 'setup'; log(room, 'The host opened the market for opening investments.'); broadcast(room); return;
  }
  if (m.type === 'trade') return buySell(ws, m);
  if (m.type === 'roll') return roll(ws, m);
  if (m.type === 'nextRound') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the host can start the next round.');
    if (room.phase !== 'trade') return error(ws, 'The next round is not ready yet.');
    room.round++; room.turn = 0; room.phase = 'playing'; room.last = `Round ${room.round} begins.`; log(room, room.last); broadcast(room); return;
  }
  error(ws, 'Unknown game action.');
}
wss.on('connection', ws => {
  ws.on('error', () => {});
  ws.on('message', raw => {
    try { const m = JSON.parse(raw.toString()); if (!m || typeof m !== 'object') return; handle(ws, m); }
    catch { error(ws, 'Could not read that action.'); }
  });
  ws.on('close', () => {
    const room = ws.room, player = room?.players.find(p => p.id === ws.playerId);
    if (player?.socket === ws) {
      player.online = false; player.socket = null;
      if (room.hostId === player.id) {
        const replacement = room.players.find(p => p.id !== player.id && p.online);
        if (replacement) room.hostId = replacement.id;
      }
      broadcast(room);
    }
  });
});
httpServer.listen(port, '0.0.0.0', () => console.log(`Stock Ticker listening on ${port}`));
