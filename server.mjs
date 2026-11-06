import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 3000);
const BUILD = '2026.11.06.07';
const DATA_FILE = resolve(process.env.STOCK_TICKER_DATA || './data/rooms.json');
const ROOM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const html = await readFile(new URL('./index.html', import.meta.url));
const httpServer = http.createServer((req, res) => {
  const apiMatch = req.url?.match(/^\/api\/rooms\/(\d{6})$/);
  if (req.method === 'GET' && apiMatch) {
    const room = rooms.get(apiMatch[1]);
    if (!room) {
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-app-build': BUILD });
      res.end(JSON.stringify({ error: 'Room not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0', 'x-app-build': BUILD });
    res.end(JSON.stringify({ state: publicState(room) }));
    return;
  }
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-app-build': BUILD });
    res.end(html);
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});
const wss = new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024, perMessageDeflate: false });
const rooms = new Map();
let persistQueue = Promise.resolve();
function persistRooms() {
  const now = Date.now();
  const snapshot = [...rooms.values()]
    .filter(room => now - (room.lastActivity || now) < ROOM_RETENTION_MS)
    .slice(-200)
    .map(room => ({ ...room, players: room.players.map(({ socket, ...player }) => ({ ...player, online: false })) }));
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    const tempFile = `${DATA_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(snapshot));
    await rename(tempFile, DATA_FILE);
  }).catch(err => console.error('Room save failed:', err.message));
  return persistQueue;
}
async function loadRooms() {
  try {
    const saved = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    const cutoff = Date.now() - ROOM_RETENTION_MS;
    for (const room of Array.isArray(saved) ? saved : []) {
      if (!/^\d{6}$/.test(room.code || '') || !Array.isArray(room.players) || (room.lastActivity || 0) < cutoff) continue;
      room.players = room.players.filter(p => p && p.id && typeof p.name === 'string').slice(0, 6).map(p => ({ ...p, socket: null, online: false, isBot: !!p.isBot }));
      room.max = [12, 20, 30].includes(room.max) ? room.max : 12;
      room.prices = Array.isArray(room.prices) && room.prices.length === 6 ? room.prices : Array(6).fill(100);
      room.history = Array.isArray(room.history) && room.history.length === 6 ? room.history : Array.from({ length: 6 }, () => [100]);
      room.events = Array.isArray(room.events) ? room.events.slice(0, 12) : [];
      room.purchases = Array.isArray(room.purchases) ? room.purchases : [];
      rooms.set(room.code, room);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Room load failed:', err.message);
  }
}
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
const freshPlayer = (name, id, isBot = false, difficulty = 'normal', strategy = 'trend') => ({ id, name, cash: 500000, shares: Array(6).fill(0), online: !isBot, isBot, difficulty, strategy });

function publicState(room) {
  return {
    code: room.code, build: BUILD, revision: room.revision, hostId: room.hostId, phase: room.phase, round: room.round, max: room.max,
    turn: room.turn, turnId: room.players[room.turn]?.id ?? null,
    prices: room.prices, history: room.history, headline: room.headline, last: room.last, events: room.events.slice(0, 12),
    recap: room.phase === 'done' ? gameRecap(room) : null, banter: marketBanter(room),
    players: room.players.map(({ id, name, cash, shares, online, isBot, difficulty, strategy }) => ({ id, name, cash, shares, online, isBot: !!isBot, difficulty, strategy, ready: shares.some(Boolean) }))
  };
}
function gameRecap(room) {
  const rankings = [...room.players].sort((a,b) => netWorth(b, room) - netWorth(a, room)).map((p, i) => ({
    name: p.name, value: netWorth(p, room), change: netWorth(p, room) - 500000, place: i + 1
  }));
  const sectors = names.map((name, i) => {
    const history = room.history[i] || [room.prices[i]], start = history[0] || 100, current = room.prices[i];
    return { name, start, current, change: current - start, percent: start ? (current - start) / start * 100 : 0 };
  }).sort((a,b) => b.percent - a.percent);
  let biggestMove = null;
  room.history.forEach((history, stock) => history.slice(1).forEach((price, j) => {
    const delta = price - history[j];
    if (!biggestMove || Math.abs(delta) > Math.abs(biggestMove.delta)) biggestMove = { stock: names[stock], delta, from: history[j], to: price };
  }));
  const bestBuy = [...(room.purchases || [])].map(p => ({
    ...p, current: room.prices[p.stock], gain: room.prices[p.stock] - p.price,
    percent: p.price ? (room.prices[p.stock] - p.price) / p.price * 100 : 0
  })).sort((a,b) => b.percent - a.percent)[0] || null;
  return { rankings, bestSector: sectors[0], worstSector: sectors.at(-1), biggestMove, bestBuy, headline: room.headline?.title || null };
}
function marketBanter(room) {
  if (room.players.length < 2 || room.phase === 'lobby' || room.phase === 'setup') return 'The market is open. Somebody is already refreshing the leaderboard.';
  const ranked = [...room.players].sort((a,b) => netWorth(b, room) - netWorth(a, room));
  const leader = ranked[0], trailer = ranked.at(-1), leadValue = netWorth(leader, room) - 500000;
  if (ranked.length > 1 && netWorth(leader, room) - netWorth(trailer, room) > 100000)
    return `${leader.name} is pulling away by ${formatMoney(netWorth(leader, room) - netWorth(trailer, room))}. The rest of the room is definitely not watching.`;
  if (leadValue > 0) return `${leader.name} is in the green and has started calling every move “conviction.”`;
  if (trailer.cash > 350000) return `${trailer.name} is holding cash like volatility owes them an apology.`;
  if (leadValue < 0) return `${leader.name} leads the board. The market would like to remind everyone that “leads” is relative.`;
  return `${leader.name} is out front. The room has become suspiciously quiet.`;
}function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function broadcast(room) {
  room.revision++;
  room.lastActivity = Date.now();
  const snapshot = publicState(room);
  for (const player of room.players) {
    const ws = player.socket;
    if (ws?.readyState === WebSocket.OPEN) send(ws, { type: 'state', state: snapshot, isHost: player.id === room.hostId });
  }
  persistRooms();
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
  if (room.phase === 'playing' && room.players[room.turn]?.isBot) scheduleBotTurn(room);
}
function addRoom(ws, m) {
  const name = String(m.name || '').trim().slice(0, 18);
  if (!name) return error(ws, 'Enter your name first.');
  const room = { code: roomCode(), revision: 0, hostId: '', phase: 'lobby', round: 0, max: [12,20,30].includes(Number(m.rounds)) ? Number(m.rounds) : 12, turn: 0, prices: Array(6).fill(100), history: Array.from({ length: 6 }, () => [100]), headline: null, last: '', events: [], purchases: [], players: [], lastActivity: Date.now() };
  const player = freshPlayer(name, randomUUID()); room.hostId = player.id; room.players.push(player); rooms.set(room.code, room);
  attach(ws, room, player, 'created');
}
function addBot(ws, m) {
  const [room, host] = getPlayer(ws, m);
  if (!room || !host || room.hostId !== host.id) return error(ws, 'Only the host can add a bot.');
  if (room.phase !== 'lobby') return error(ws, 'Bots can only join before the game starts.');
  if (room.players.length >= 6) return error(ws, 'This room is full.');
  const botNumber = room.players.filter(p => p.isBot).length + 1;
  const difficulty = ['easy', 'normal', 'hard'].includes(m.difficulty) ? m.difficulty : 'normal';
  const strategy = ['trend', 'value', 'contrarian'].includes(m.strategy) ? m.strategy : 'trend';
  const bot = freshPlayer(`TickerBot ${botNumber}`, `bot-${randomUUID()}`, true, difficulty, strategy);
  room.players.push(bot);
  log(room, `${bot.name} joined the room. Ready to speculate.`);
  broadcast(room);
}
function rematch(ws, m) {
  const [room, host] = getPlayer(ws, m);
  if (!room || !host || room.hostId !== host.id) return error(ws, 'Only the host can start a rematch.');
  if (room.phase !== 'done') return error(ws, 'Finish the current game before starting a rematch.');
  room.players = room.players.filter(p => p.isBot || p.id === host.id || p.online);
  room.players.sort((a,b) => a.id === host.id ? -1 : b.id === host.id ? 1 : 0);
  for (const player of room.players) { player.cash = 500000; player.shares = Array(6).fill(0); player.online = player.isBot ? false : !!player.socket; }
  room.phase = 'lobby'; room.round = 0; room.turn = 0; room.prices = Array(6).fill(100);
  room.history = Array.from({ length: 6 }, () => [100]); room.headline = null; room.last = '';
  room.events = []; room.purchases = [];
  log(room, `${host.name} started a rematch. Everyone is back at the opening bell.`);
  broadcast(room);
}
function joinRoom(ws, m) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  const name = String(m.name || '').trim().slice(0, 18);
  if (!room) return error(ws, 'That room code was not found.');
  if (!name) return error(ws, 'Enter your name first.');
  if (room.phase === 'done') return error(ws, 'This game has ended. Ask the host to start a new room.');
  if (room.players.length >= 6) return error(ws, 'This room is full.');
  const player = freshPlayer(name, randomUUID());
  if (['playing', 'trade'].includes(room.phase)) {
    const stock = randomInt(names.length), lotCost = room.prices[stock] * 500;
    player.shares[stock] = 500; player.cash -= lotCost;
    room.purchases.push({ name, stock, shares: 500, price: room.prices[stock], round: room.round });
    log(room, `${name} joined mid-game with 500 ${names[stock]} shares at ${formatMoney(room.prices[stock])} per share.`);
  } else log(room, `${name} joined the room.`);
  room.players.push(player); attach(ws, room, player, 'joined');
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
  if (qty > 0) room.purchases.push({ name: player.name, stock, shares: qty, price: room.prices[stock], round: room.round });
  log(room, `${player.name} ${qty > 0 ? 'bought' : 'sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])}.`);
  if (room.phase === 'setup' && room.players.every(p => p.shares.some(Boolean))) {
    room.phase = 'playing'; room.round = 1; room.turn = 0;
    room.last = 'Opening bell! Everyone is invested.'; log(room, 'The opening bell rang. The first player is up.');
  }
  broadcast(room);
  send(ws, { type: 'notice', message: `${qty > 0 ? 'Bought' : 'Sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])} per share.` });
}
function formatMoney(cents) { return '$' + (cents / 100).toFixed(2); }
function botOpeningInvestment(room, bot) {
  const stock = randomInt(names.length), shares = 500, cost = room.prices[stock] * shares;
  bot.cash -= cost; bot.shares[stock] += shares;
  room.purchases.push({ name: bot.name, stock, shares, price: room.prices[stock], round: 0 });
  log(room, `${bot.name} opened a ${names[stock]} position.`);
}
function botTrade(room, bot) {
  const trends = names.map((_, i) => {
    const series = room.history[i].slice(-4);
    return { stock: i, momentum: (series.at(-1) ?? room.prices[i]) - (series[0] ?? room.prices[i]), price: room.prices[i] };
  });
  if (bot.difficulty === 'easy' && randomInt(4) === 0) return;
  const weak = bot.strategy === 'value' ? trends.filter(t => t.price >= 140 && bot.shares[t.stock] >= 500).sort((a,b) => b.price - a.price)
    : bot.strategy === 'contrarian' ? trends.filter(t => t.momentum > 0 && t.price >= 110 && bot.shares[t.stock] >= 500).sort((a,b) => b.momentum - a.momentum)
    : trends.filter(t => t.momentum < 0 && bot.shares[t.stock] >= 500).sort((a,b) => a.momentum - b.momentum);
  if (weak.length) {
    const t = weak[0]; bot.shares[t.stock] -= 500; bot.cash += room.prices[t.stock] * 500;
    log(room, `${bot.name} sold 500 ${names[t.stock]} shares (${bot.strategy} strategy).`); return;
  }
  const picks = trends.filter(t => bot.cash >= room.prices[t.stock] * 500).map(t => ({ ...t,
    score: bot.strategy === 'value' ? (100 - t.price) + Math.max(-20, t.momentum) * 0.25
      : bot.strategy === 'contrarian' ? (t.price <= 100 && t.momentum < 0 ? -t.momentum : -1000)
        : (t.momentum > 0 ? t.momentum * 100 / Math.max(1, t.price) : -1000)
  })).filter(t => t.score > 0).sort((a,b) => b.score - a.score);
  if (picks.length) {
    const t = bot.difficulty === 'easy' && picks.length > 1 ? picks[randomInt(Math.min(2, picks.length))] : picks[0];
    const lots = bot.difficulty === 'hard' ? 2 : 1, price = room.prices[t.stock];
    const bought = Math.min(lots, Math.floor(bot.cash / (price * 500)));
    if (!bought) return;
    bot.cash -= price * 500 * bought; bot.shares[t.stock] += 500 * bought;
    room.purchases.push({ name: bot.name, stock: t.stock, shares: 500 * bought, price, round: room.round });
    log(room, `${bot.name} bought ${500 * bought} ${names[t.stock]} shares (${bot.difficulty} ${bot.strategy}).`);
  }
}
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
function resolveRoll(room, player) {
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
    } else {
      room.phase = 'trade'; room.last += ' Trading is now open.';
      for (const bot of room.players.filter(p => p.isBot)) botTrade(room, bot);
    }
  } else recordHistory(room);
  broadcast(room);
  if (room.phase === 'playing' && room.players[room.turn]?.isBot) scheduleBotTurn(room);
}
function scheduleBotTurn(room) {
  if (room.botScheduled || room.phase !== 'playing' || !room.players[room.turn]?.isBot) return;
  room.botScheduled = true;
  setTimeout(() => playBotTurn(room), 850);
}
function playBotTurn(room) {
  if (room.phase !== 'playing') { room.botScheduled = false; return; }
  const bot = room.players[room.turn];
  if (!bot?.isBot) { room.botScheduled = false; return; }
  log(room, `${bot.name} is weighing the market…`); broadcast(room);
  setTimeout(() => {
    if (room.phase === 'playing' && room.players[room.turn]?.id === bot.id) {
      room.botScheduled = false;
      resolveRoll(room, bot);
    } else room.botScheduled = false;
  }, 500);
}
function roll(ws, m) {
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
  if (room.phase !== 'playing') return error(ws, 'The market is not taking rolls right now.');
  const currentPlayer = room.players[room.turn];
  if (currentPlayer?.id !== player.id && !(player.id === room.hostId && currentPlayer && !currentPlayer.online)) return error(ws, 'Wait for your turn.');
  resolveRoll(room, player);
}
function netWorth(p, room) { return p.cash + p.shares.reduce((sum, count, i) => sum + count * room.prices[i], 0); }
function handle(ws, m) {
  if (m.type === 'ping') return send(ws, { type: 'pong' });
  if (m.type === 'create') return addRoom(ws, m);
  if (m.type === 'join') return joinRoom(ws, m);
  if (m.type === 'reconnect') return reconnect(ws, m);
  if (m.type === 'addBot') return addBot(ws, m);
  if (m.type === 'rematch') return rematch(ws, m);
  if (m.type === 'start') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the room host can start the game.');
    if (room.phase !== 'lobby') return error(ws, 'The game has already started.');
    if (room.players.length < 2) return error(ws, 'At least two players are needed.');
    room.phase = 'setup'; log(room, 'The host opened the market for opening investments.');
    for (const bot of room.players.filter(p => p.isBot)) botOpeningInvestment(room, bot);
    broadcast(room); return;
  }
  if (m.type === 'trade') return buySell(ws, m);
  if (m.type === 'roll') return roll(ws, m);
  if (m.type === 'nextRound') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the host can start the next round.');
    if (room.phase !== 'trade') return error(ws, 'The next round is not ready yet.');
    room.round++; room.turn = 0; room.phase = 'playing'; room.last = `Round ${room.round} begins.`; log(room, room.last); broadcast(room); return;
  }
  if (m.type === 'endGame') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the room host can end the game.');
    if (['lobby', 'done'].includes(room.phase)) return error(ws, 'There is no active game to end.');
    room.phase = 'done'; room.players.sort((a,b) => netWorth(b, room) - netWorth(a, room));
    room.last = `The host ended the game after round ${room.round}. Final portfolios are ranked.`;
    log(room, room.last); broadcast(room); return;
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
await loadRooms();
process.on('SIGINT', () => { persistRooms().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { persistRooms().finally(() => process.exit(0)); });
httpServer.listen(port, '0.0.0.0', () => console.log(`Stock Ticker listening on ${port}`));
