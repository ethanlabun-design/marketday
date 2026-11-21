import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 3000);
const BUILD = '2026.11.21.04';
const DATA_FILE = resolve(process.env.STOCK_TICKER_DATA || './data/rooms.json');
const ROOM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ROLL_CHOICES = [1, 3, 5, 7, 10, 20];
const ROUND_CHOICES = [12, 20, 30];
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
      room.players = room.players.filter(p => p && p.id && typeof p.name === 'string').slice(0, 6).map(p => ({ ...p, socket: null, online: false, isBot: !!p.isBot, shorts: Array.isArray(p.shorts) ? p.shorts : Array(6).fill(0), shortProceeds: Array.isArray(p.shortProceeds) ? p.shortProceeds : Array(6).fill(0), shareBasis: Array.isArray(p.shareBasis) ? p.shareBasis : (p.shares || Array(6).fill(0)).map((count,i)=>count*(room.prices?.[i]||100)), assetRealized: Array.isArray(p.assetRealized) ? p.assetRealized : Array(6).fill(0), options: Array.isArray(p.options) ? p.options : [], loanBalance: Number(p.loanBalance) || 0, loanCount: Number(p.loanCount) || 0 }));
      room.max = ROUND_CHOICES.includes(room.max) ? room.max : 12;
      room.prices = Array.isArray(room.prices) && room.prices.length === 6 ? room.prices : Array(6).fill(100);
      room.lastMoves = Array.isArray(room.lastMoves) && room.lastMoves.length === 6 ? room.lastMoves : Array(6).fill(0);
      room.history = Array.isArray(room.history) && room.history.length === 6 ? room.history : Array.from({ length: 6 }, () => [100]);
      room.events = Array.isArray(room.events) ? room.events.slice(0, 20) : [];
      room.activity = Array.isArray(room.activity) ? room.activity.slice(0,250) : [];
      room.headlines = Array.isArray(room.headlines) ? room.headlines.slice(0,200) : (room.headline?[room.headline]:[]);
      room.etfHistory = Array.isArray(room.etfHistory) ? room.etfHistory : Array.from({length:5},()=>[100]);
      for(const p of room.players){p.etfShares=Array.isArray(p.etfShares)?p.etfShares:Array(5).fill(0);p.etfBasis=Array.isArray(p.etfBasis)?p.etfBasis:Array(5).fill(0)}
      room.purchases = Array.isArray(room.purchases) ? room.purchases : [];
      if (!room.players.some(p => p.id === room.ownerId)) room.ownerId = room.hostId;
      // Older rooms may hold 2 rolls per turn; keep any whole number up to the largest choice.
      room.rollsPerTurn = Number.isInteger(room.rollsPerTurn) && room.rollsPerTurn >= 1 && room.rollsPerTurn <= Math.max(...ROLL_CHOICES) ? room.rollsPerTurn : 1;
      room.rollsLeft = Number.isInteger(room.rollsLeft) && room.rollsLeft >= 1 && room.rollsLeft <= room.rollsPerTurn ? room.rollsLeft : room.rollsPerTurn;
      room.readyIds = Array.isArray(room.readyIds) ? room.readyIds : [];
      rooms.set(room.code, room);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Room load failed:', err.message);
  }
}
const names = ['AI', 'Crypto', 'Real Estate', 'Defense', 'Government', 'Medicine'];
const tickers = ['AIX','CRYP','REITX','DFNS','CIVX','MEDX'];
const etfs = [
  { name: 'Broad Market ETF', ticker: 'CORE', weights: [0.2,0.15,0.15,0.15,0.2,0.15] },
  { name: 'AI & Robotics ETF', ticker: 'ROBO', weights: [0.65,0.1,0.05,0.05,0.1,0.05] },
  { name: 'Healthcare ETF', ticker: 'CARE', weights: [0.1,0,0.05,0.05,0.2,0.6] },
  { name: 'Digital Assets ETF', ticker: 'WEB3', weights: [0.15,0.7,0.05,0.02,0.06,0.02] },
  { name: 'Infrastructure ETF', ticker: 'BUILD', weights: [0.1,0.05,0.3,0.15,0.3,0.1] }
];
function etfPrices(room) { return etfs.map(etf => Math.round(etf.weights.reduce((sum,w,i)=>sum+w*room.prices[i],0))); }
function portfolioValue(p, room) { return netWorth(p,room); }
function activity(room, entry) {
  room.activity ||= [];
  const signature = `${room.revision||0}:${entry.kind}:${entry.playerId||''}:${entry.asset||''}:${entry.quantity||''}:${entry.round||room.round}`;
  if (room.activity.some(item=>item.signature===signature)) return;
  room.activity.unshift({ id: randomUUID(), signature, at: Date.now(), round: room.round, ...entry });
  room.activity = room.activity.slice(0,250);
}
function roundValues(room) { room.roundStartValues = Object.fromEntries(room.players.map(p=>[p.id,portfolioValue(p,room)])); }
// Marketwire stories written for each dice result: rollStories[action][sector] -> [title, detail].
// The headline only narrates the roll; the dice alone move prices and pay dividends.
const rollStories = {
  up: [
    [['AI MODEL FINALLY UNDERSTANDS THE ASSIGNMENT', 'A chatbot summarizes an entire terms-of-service page without crying. Investors stampede in.'],
     ['AI AGENT AUTOMATES THE ENTIRE BACK OFFICE', 'Productivity soars. The fax machine has been escorted out of the building by security.'],
     ['JUDGE RULES ROBOTS MAY KEEP THEIR HOBBIES', 'A sweeping tech rule is blocked, and AI developers celebrate with a cake none of them can eat.']],
    [['GRANDMA ASKS ABOUT CRYPTO AT THANKSGIVING', 'Analysts call it the most bullish signal in history. Inflows arrive before dessert.'],
     ['BLOCKCHAIN BROS DISCOVER BORING BONDS', 'Tokenized treasuries draw big money. Government debt is cool if you put it on a chain.'],
     ['EXCHANGE GOES 24/7, TRADERS GO 0 HOURS OF SLEEP', 'Round-the-clock trading pumps volume, along with the number of people checking charts at 3 a.m.']],
    [['CENTRAL BANK CUTS RATES, WINKS AT CAMERA', 'Cheap money is back. Every cousin with a truck announces a career in house flipping.'],
     ['MORTGAGE RATES DIP, OPEN HOUSES GET CROWDED', 'Buyers return, mostly for the free cookies, but some of them sign things.'],
     ['TINY HOMES REBRANDED AS "COZY"', 'A bold marketing move by realtors sends property shares up by about one closet.']],
    [['GENERALS ORDER "ONE OF EVERYTHING"', 'Procurement officers go on a shopping spree with no receipt limit.'],
     ['ALLIES SIGN DEFENSE PACT, SWAP FRIENDSHIP BRACELETS', 'A multiyear deal gives contractors a long runway of orders and matching jewelry.'],
     ['DRONES ACE FIELD TEST, ALSO DELIVER PIZZA', 'Defense budgets make room for new hardware. Contractors note the pizza arrived hot.']],
    [['CONGRESS PASSES A BILL, EVERYONE FAINTS', 'An infrastructure package clears committee. Contractors pour the ceremonial concrete.'],
     ['SHUTDOWN AVERTED WITH SEVEN SECONDS TO SPARE', 'Agencies stay open and suppliers finally send invoices with confidence.'],
     ['GOVERNMENT MOVES TO THE CLOUD, FORGETS PASSWORD', 'The contract is awarded anyway. Suppliers are thrilled to reset it.']],
    [['CANCER DRUG CRUSHES TRIAL, SCIENTISTS HIGH-FIVE', 'Results are so good the lab ordered a second cake.'],
     ['BIOTECH MICE DOING SUSPICIOUSLY WELL', 'A tiny study creates enormous expectations. The mice are reportedly considering an IPO.'],
     ['VACCINE REVIEW SKIPS THE LINE', 'Regulators fast-track approval and medical makers finally stop chewing their pens.']]
  ],
  down: [
    [['DATA CENTER TRIPS BREAKER, TAKES OUT THREE TOWNS', 'Engineers say the AI was "just thinking really hard." Residents want their microwaves back.'],
     ['CHIP SHORTAGE: SOMEONE FORGOT THE BOXES', 'The AI hardware rush meets its greatest enemy: cardboard.'],
     ['NEW PRIVACY RULES: AI MUST STOP READING YOUR DIARY', 'Model makers face compliance costs and a lot of awkward apologies.']],
    [['EXCHANGE PAUSES WITHDRAWALS "FOR A QUICK SEC"', 'It has been several secs. Traders refresh the app like lab rats pressing a lever.'],
     ["QUANTUM COMPUTER GUESSES EVERYONE'S PASSWORD", 'It was "password123" for 40% of wallets. Panic ensues.'],
     ['WALLET BUG FREEZES TOKEN, OWNERS FREEZE TOO', 'A software flaw locks a popular coin. Security firms bill by the panic attack.']],
    [['OFFICE TOWERS NOW 90% PLANTS', 'Remote work wins again. Landlords consider renting desks to houseplants, who at least show up.'],
     ['INSURERS DISCOVER THE OCEAN IS WET', 'Coastal premiums soar after a groundbreaking actuarial study.'],
     ['DEVELOPER BUILDS ONE VERY EXPENSIVE HOLE', 'Projects stall as costs climb. The hole is reportedly quite nice, as holes go.']],
    [['WORLD LEADERS AGREE TO "JUST CHILL"', 'A surprise ceasefire leaves contractors staring at very large, very unsold warehouses.'],
     ['TANK SHIPMENT STUCK BEHIND ONE SLOW TRUCK', 'Deliveries slip while a very cautious driver refuses to pass.'],
     ['AUDIT FINDS A $40,000 HAMMER', 'Contractors explain their spreadsheets, and one very premium hammer, on live TV.']],
    [['SHUTDOWN LOOMS OVER SNACK BUDGET', 'Lawmakers deadlock over the break-room vending machine.'],
     ['PUBLIC WORKS PLAN BURIED UNDER PAPERWORK', 'The permit pile now needs its own permit.'],
     ['AGENCY REPLY-ALLS 40,000 EMPLOYEES', 'Productivity halts as everyone asks to be removed from the list.']],
    [['REGULATOR SENDS BLOCKBUSTER DRUG TO ITS ROOM', 'Officials want "more data" and "a better attitude."'],
     ['PHARMACIES RUN OUT OF THE BORING PILLS', 'Supply chains wobble and patients start googling "is chalk medicine."'],
     ['HOSPITAL WI-FI PASSWORD LEAKED: IT WAS "HOSPITAL"', 'A security scare sends medical shares to the waiting room.']]
  ],
  dividend: [
    [['AI PAYS DIVIDEND, INSISTS IT IS "JUST BEING HELPFUL"', 'Shareholders get paid, and the model asks if there is anything else it can help with.'],
     ['ROBOTS SHARE PROFITS, REFUSE TO EXPLAIN HOW', 'The board approves a payout drafted entirely by autocomplete.']],
    [['CRYPTO PAYS A DIVIDEND IN ACTUAL MONEY', 'Holders are confused but grateful. Several frame the receipt.'],
     ['TOKEN DEVS AIRDROP CASH, NOT JPEGS', 'Shareholders celebrate a rare payout that is not a cartoon ape.']],
    [['LANDLORDS COLLECT RENT, SHARE A LITTLE', 'Property owners pass the rent along to shareholders, minus a small "vibes" fee.'],
     ['REAL ESTATE PAYS OUT, STILL KEEPS YOUR DEPOSIT', 'Shareholders get paid. Former tenants are still waiting on theirs.']],
    [['DEFENSE FIRM MAILS DIVIDENDS IN CAMO ENVELOPES', 'Shareholders report some difficulty finding the checks.'],
     ['CONTRACTOR SHARES A "MISSION ACCOMPLISHED" BONUS', 'The payout arrives right on schedule, unlike the jets.']],
    [['GOVERNMENT ISSUES A REFUND, NOBODY BELIEVES IT', 'A dividend arrives in the mail with only three forms to fill out.'],
     ['BUDGET SURPLUS FOUND IN COUCH CUSHIONS', 'Officials hand the spare change back to shareholders.']],
    [['PHARMA PAYS DIVIDEND, SIDE EFFECTS INCLUDE JOY', 'Shareholders may experience smiling. Consult your broker.'],
     ['HOSPITAL CAFETERIA PROFITS SHARED WITH INVESTORS', 'The jello division had a record quarter.']]
  ]
};
const moveSizes = { 5: 'SMALL MOVE', 10: 'BIG MOVE', 20: 'HUGE MOVE' };
const freshPlayer = (name, id, isBot = false, difficulty = 'normal', strategy = 'trend') => ({ id, name, cash: 500000, shares: Array(6).fill(0), shareBasis: Array(6).fill(0), etfShares:Array(5).fill(0), etfBasis:Array(5).fill(0), shorts: Array(6).fill(0), shortProceeds: Array(6).fill(0), assetRealized: Array(6).fill(0), options: [], loanBalance: 0, loanCount: 0, online: !isBot, isBot, difficulty, strategy });

function publicState(room) {
  return {
    code: room.code, build: BUILD, revision: room.revision, hostId: room.hostId, phase: room.phase, round: room.round, max: room.max, gameMode: room.gameMode || 'classic',
    turn: room.turn, turnId: room.players[room.turn]?.id ?? null, ownerId: room.ownerId, rollsPerTurn: room.rollsPerTurn || 1, rollsLeft: room.rollsLeft || room.rollsPerTurn || 1, readyIds: room.readyIds || [],
    prices: room.prices, history: room.history, lastMoves:room.lastMoves||Array(6).fill(0), lastRoll:room.lastRoll||null, headline: room.headline, headlines: room.headlines||[], last: room.last, events: room.events.slice(0, 20), activity: room.activity||[], etfs, etfPrices: etfPrices(room), etfHistory:room.etfHistory||[], tickers,
    sentiment: (()=>{const moves=(room.headline?.impacts||[]).map(x=>Number(String(x).match(/([+-]\d+)¢/)?.[1]||0));const score=moves.reduce((a,b)=>a+b,0);return {score,label:score>0?'Bullish':score<0?'Bearish':'Neutral'};})(),
    recap: room.phase === 'done' ? gameRecap(room) : null, banter: room.banter || marketBanter(room),
    leaderboard: [...room.players].sort((a,b)=>portfolioValue(b,room)-portfolioValue(a,room)).map((p,i)=>({id:p.id,place:i+1,value:portfolioValue(p,room),cash:p.cash,returns:portfolioValue(p,room)-500000,percent:(portfolioValue(p,room)-500000)/500000*100,roundChange:portfolioValue(p,room)-(room.roundStartValues?.[p.id]??portfolioValue(p,room))})),
    players: room.players.map(({ id, name, cash, shares, shareBasis, shorts, shortProceeds, assetRealized, options, loanBalance, loanCount, dividendsTotal, etfShares, etfBasis, online, isBot, isLocal, controllerId, difficulty, strategy }) => ({ id, name, cash, shares, shareBasis, shorts, shortProceeds, assetRealized, options, loanBalance, loanCount, dividendsTotal: dividendsTotal || 0, etfShares:etfShares||Array(etfs.length).fill(0), etfBasis:etfBasis||Array(etfs.length).fill(0), online, isBot: !!isBot, isLocal: !!isLocal, controllerId: isLocal ? controllerId : null, difficulty, strategy, ready: shares.some(Boolean)||!!etfShares?.some(Boolean) }))
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
  const ranked=[...room.players].sort((a,b)=>netWorth(b,room)-netWorth(a,room)),leader=ranked[0],trailer=ranked.at(-1),leadValue=netWorth(leader,room)-500000,gap=netWorth(leader,room)-netWorth(trailer,room),lines=[];
  if(gap>100000) lines.push(leader.name+' is ahead by '+formatMoney(gap)+'. The leaderboard is trying to act casual.',leader.name+' has opened a '+formatMoney(gap)+' lead. Somewhere, a group chat has gone quiet.','The gap is '+formatMoney(gap)+'. '+trailer.name+' is calling it a “long-term chart pattern.”');
  if(leadValue>0) lines.push(leader.name+' is up '+formatMoney(leadValue)+'. Their confidence has its own ticker now.',leader.name+' is in the green. Suddenly every earlier decision was “the plan.”',leader.name+' is ahead and has begun explaining the market to the market.');
  if(trailer.cash>350000) lines.push(trailer.name+' is holding cash like volatility owes them an apology.',trailer.name+' has plenty of cash and absolutely no obligation to use it.',trailer.name+' is keeping powder dry. The powder is starting to ask questions.');
  if(ranked.some(p=>p.options?.length)) lines.push('There are open options on the board. Time decay has entered the chat.','Someone bought a deadline and called it a strategy. The market will provide a review.');
  if(ranked.some(p=>p.shorts?.some(Boolean))) lines.push('Short sellers are watching every uptick like it was personally arranged.','Borrowed shares, borrowed confidence. The next headline gets a vote.','The shorts are open; the room has started rooting for a red candle.');
  if(ranked.some(p=>p.loanBalance>0)) lines.push('Debt is up, optimism is up, and the interest meter is quietly doing its job.','A loan can buy time. It can also buy 3% interest per round.','Someone borrowed $1,000 from future them. Future them has been notified.');
  if(leadValue<0) lines.push(leader.name+' is leading the board. The board is currently below par.',leader.name+' is out front, in the technical sense that someone has to be.','The market has marked portfolios down. Everyone is now a value investor.');
  if(!lines.length) lines.push(leader.name+' is out front. Nobody trusts the leaderboard yet.','Portfolios are close. Every headline now has main-character energy.','The market is flat; the players are developing theories.');
  const recent=room.banterHistory||[],fresh=lines.filter(line=>!recent.includes(line)),pool=fresh.length?fresh:lines,selected=pool[randomInt(pool.length)];room.banterHistory=[...recent,selected].slice(-8);return selected;
}function send(ws, message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
function broadcast(room) {
  room.revision++;
  room.lastActivity = Date.now();
  room.banter = marketBanter(room);
  const snapshot = publicState(room);
  for (const player of room.players) {
    const ws = player.socket;
    if (ws?.readyState === WebSocket.OPEN) send(ws, { type: 'state', state: snapshot, isHost: player.id === room.hostId });
  }
  persistRooms();
}
function log(room, message) { room.events.unshift(message); room.events = room.events.slice(0, 20); }
function error(ws, message) { send(ws, { type: 'error', message }); }
function getPlayer(ws, m, allowSeat = false) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  if (!room || room !== ws.room) return [null, null];
  const player = room.players.find(p => p.id === ws.playerId);
  // Pass and play: a device may act for the local seats it controls.
  if (allowSeat && player && m.actAs && m.actAs !== player.id) {
    const seat = room.players.find(p => p.id === m.actAs && p.isLocal && p.controllerId === player.id);
    return [room, seat || null];
  }
  return [room, player];
}
function setSeatsOnline(room, controller, online) {
  for (const seat of room.players) if (seat.isLocal && seat.controllerId === controller.id) seat.online = online;
}
function addLocal(ws, m) {
  const [room, owner] = getPlayer(ws, m);
  if (!room || !owner) return error(ws, 'Join a room first.');
  if (owner.isLocal) return error(ws, 'Only the device owner can add players.');
  if (room.phase !== 'lobby') return error(ws, 'Pass-and-play players can only join before the game starts.');
  if (room.players.length >= 6) return error(ws, 'This room is full.');
  const name = String(m.name || '').trim().slice(0, 18);
  if (!name) return error(ws, 'Enter a nickname for the new player.');
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return error(ws, 'Someone in the room already has that name.');
  const seat = freshPlayer(name, `local-${randomUUID()}`);
  seat.isLocal = true; seat.controllerId = owner.id; seat.online = owner.online;
  // Sit next to the device owner (and their other seats) so the device passes along the table.
  let at = room.players.findIndex(p => p.id === owner.id);
  while (room.players[at + 1]?.controllerId === owner.id) at++;
  room.players.splice(at + 1, 0, seat);
  activity(room, { kind: 'join', playerId: seat.id, playerName: seat.name, asset: 'Market', quantity: 1, round: room.round });
  log(room, `${seat.name} joined on ${owner.name}'s device (pass and play).`);
  broadcast(room);
}
function removeLocal(ws, m) {
  const [room, owner] = getPlayer(ws, m);
  if (!room || !owner) return error(ws, 'Join a room first.');
  if (room.phase !== 'lobby') return error(ws, 'Players can only be removed in the waiting room.');
  const seat = room.players.find(p => p.id === m.seatId && p.isLocal && (p.controllerId === owner.id || room.hostId === owner.id));
  if (!seat) return error(ws, 'That player is not on this device.');
  room.players = room.players.filter(p => p !== seat);
  log(room, `${seat.name} left the table.`);
  broadcast(room);
}
function roomCode() {
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
}
const HOST_GRACE_MS = 30 * 1000;
const hostHandoffTimers = new Map();
function cancelHostHandoff(room) {
  clearTimeout(hostHandoffTimers.get(room.code));
  hostHandoffTimers.delete(room.code);
}
// Give the host a grace period (e.g. a page refresh) before passing hosting to another online player.
function scheduleHostHandoff(room, host) {
  cancelHostHandoff(room);
  hostHandoffTimers.set(room.code, setTimeout(() => {
    hostHandoffTimers.delete(room.code);
    if (room.hostId !== host.id || host.online || rooms.get(room.code) !== room) return;
    const replacement = room.players.find(p => p.id !== host.id && p.online && !p.isBot && !p.isLocal);
    if (!replacement) return;
    room.hostId = replacement.id;
    log(room, `${host.name} went offline, so ${replacement.name} is hosting for now.`);
    broadcast(room);
  }, HOST_GRACE_MS));
}
function attach(ws, room, player, type) {
  ws.room = room; ws.playerId = player.id; player.socket = ws; player.online = true; setSeatsOnline(room, player, true);
  if (room.hostId === player.id) cancelHostHandoff(room);
  else if (room.ownerId === player.id) {
    cancelHostHandoff(room);
    room.hostId = player.id;
    log(room, `${player.name} is back and hosting again.`);
  }
  send(ws, { type, roomCode: room.code, playerId: player.id, isHost: player.id === room.hostId });
  broadcast(room);
  if (room.phase === 'playing' && room.players[room.turn]?.isBot) scheduleBotTurn(room);
}
function addRoom(ws, m) {
  const name = String(m.name || '').trim().slice(0, 18);
  if (!name) return error(ws, 'Enter your name first.');
  const room = { code: roomCode(), revision: 0, hostId: '', phase: 'lobby', round: 0, lastMoves:Array(6).fill(0), lastRoll:null, max: [12,20,30].includes(Number(m.rounds)) ? Number(m.rounds) : 12, gameMode: m.gameMode === 'advanced' ? 'advanced' : 'classic', rollsPerTurn: 1, rollsLeft: 1, readyIds: [], turn: 0, prices: Array(6).fill(100), history: Array.from({ length: 6 }, () => [100]), headline: null, headlines: [], last: '', events: [], activity: [], purchases: [], players: [], lastActivity: Date.now() };
  const player = freshPlayer(name, randomUUID()); room.hostId = player.id; room.ownerId = player.id; room.players.push(player); rooms.set(room.code, room);
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
  for (const player of room.players) { player.cash = 500000; player.shares = Array(6).fill(0); player.shareBasis = Array(6).fill(0);player.etfShares=Array(5).fill(0);player.etfBasis=Array(5).fill(0); player.shorts = Array(6).fill(0); player.shortProceeds = Array(6).fill(0); player.assetRealized = Array(6).fill(0); player.options = []; player.loanBalance = 0; player.loanCount = 0; player.dividendsTotal = 0; player.online = player.isBot ? false : player.isLocal ? !!room.players.find(c => c.id === player.controllerId)?.socket : !!player.socket; }
  room.phase = 'lobby'; room.round = 0; room.turn = 0; room.rollsLeft = room.rollsPerTurn || 1; room.readyIds = []; room.prices = Array(6).fill(100);room.lastMoves=Array(6).fill(0);room.lastRoll=null;
  room.history = Array.from({ length: 6 }, () => [100]);room.lastMoves=Array(6).fill(0);room.lastRoll=null;room.etfHistory=Array.from({length:5},()=>[100]); room.headline = null; room.headlines=[]; room.last = '';
  room.events = []; room.activity=[];room.headlines=[];room.etfHistory=Array.from({length:5},()=>[100]);room.purchases = [];
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
    player.shares[stock] = 500; player.shareBasis[stock] = lotCost; player.cash -= lotCost;
    room.purchases.push({ name, stock, shares: 500, price: room.prices[stock], round: room.round });
    activity(room,{kind:'buy',playerId:player.id,playerName:player.name,asset:names[stock],ticker:tickers[stock],quantity:500,price:room.prices[stock],round:room.round});
    log(room, `${name} joined mid-game with 500 ${names[stock]} shares at ${formatMoney(room.prices[stock])} per share.`);
  } else log(room, `${name} joined the room.`);
  room.players.push(player); activity(room,{kind:'join',playerId:player.id,playerName:player.name,asset:'Market',quantity:1,round:room.round});log(room,`${player.name} joined the room.`);attach(ws, room, player, 'joined');
}
function reconnect(ws, m) {
  const room = rooms.get(String(m.roomCode || '').toUpperCase());
  const player = room?.players.find(p => p.id === m.playerId);
  if (!room || !player) return error(ws, 'Room session not found. Return to the lobby and join again.');
  if (player.socket && player.socket !== ws && player.socket.readyState === WebSocket.OPEN) player.socket.close(4001, 'Reconnected elsewhere');
  attach(ws, room, player, 'reconnected');
}
function buySell(ws, m) {
  const [room, player] = getPlayer(ws, m, true); if (!room || !player) return error(ws, 'Join a room first.');
  if (!['setup', 'trade'].includes(room.phase)) return error(ws, 'Trading is closed right now.');
  if(m.assetType==='etf'){
    const index=Number(m.stock),qty=Number(m.shares),price=etfPrices(room)[index];
    if(!Number.isInteger(index)||index<0||index>=etfs.length||!Number.isInteger(qty)||!qty||Math.abs(qty)%500||Math.abs(qty)>10000)return error(ws,'Choose a valid ETF order in 500-share lots.');
    const cost=price*qty;player.etfShares||=Array(etfs.length).fill(0);player.etfBasis||=Array(etfs.length).fill(0);
    if(qty>0&&player.cash<cost)return error(ws,'Not enough cash for that ETF purchase.');if(qty<0&&player.etfShares[index]<-qty)return error(ws,'You do not own enough ETF shares to sell.');
    if(qty>0)player.etfBasis[index]+=cost;else{const held=player.etfShares[index];player.etfBasis[index]=held<=-qty?0:player.etfBasis[index]*(held+qty)/held}
    player.cash-=cost;player.etfShares[index]+=qty;activity(room,{kind:qty>0?'buy':'sell',playerId:player.id,playerName:player.name,asset:etfs[index].ticker,assetName:etfs[index].name,quantity:Math.abs(qty),price,round:room.round});log(room,`${player.name} ${qty>0?'bought':'sold'} ${Math.abs(qty).toLocaleString()} ${etfs[index].name} shares at ${formatMoney(price)}.`);broadcast(room);send(ws,{type:'notice',message:`${qty>0?'Bought':'Sold'} ${Math.abs(qty).toLocaleString()} ${etfs[index].ticker} at ${formatMoney(price)} per share.`});return;
  }
  const stock = Number(m.stock), qty = Number(m.shares);
  if (!Number.isInteger(stock) || stock < 0 || stock >= 6 || !Number.isInteger(qty) || qty === 0 || Math.abs(qty) % 500 !== 0 || Math.abs(qty) > 10000) return error(ws, 'That trade is not valid.');
  const cost = qty * room.prices[stock];
  if (qty > 0 && player.cash < cost) return error(ws, 'Not enough cash for that purchase.');
  if (qty < 0 && player.shares[stock] < -qty) return error(ws, 'You do not own enough shares to sell that lot.');
  const freeCash = player.cash - shortCollateral(player, room);
  if (qty > 0 && freeCash < cost) return error(ws, 'That buy would use cash reserved for your short positions. Cover a short or repay the loan first.');
  player.shareBasis ||= Array(6).fill(0); player.assetRealized ||= Array(6).fill(0);
  if(qty>0) player.shareBasis[stock]+=cost;
  else { const held=player.shares[stock],sold=-qty,basis=player.shareBasis[stock]||0;player.assetRealized[stock]+=(room.prices[stock]*sold)-(held?basis*sold/held:0);player.shareBasis[stock]=held?sold>=held?0:basis*(held-sold)/held:0; }
  player.cash -= cost; player.shares[stock] += qty;
  activity(room,{kind:qty>0?'buy':'sell',playerId:player.id,playerName:player.name,asset:names[stock],ticker:tickers[stock],quantity:Math.abs(qty),price:room.prices[stock],round:room.round});
  if (qty > 0) room.purchases.push({ name: player.name, stock, shares: qty, price: room.prices[stock], round: room.round });
  log(room, `${player.name} ${qty > 0 ? 'bought' : 'sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])}.`);
  // Opening buys no longer end the setup phase; players ready up when they are done shopping.
  if (room.phase === 'setup' && !isInvested(player)) room.readyIds = (room.readyIds || []).filter(id => id !== player.id);
  broadcast(room);
  send(ws, { type: 'notice', message: `${qty > 0 ? 'Bought' : 'Sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])} per share.` });
}
const SHORT_COLLATERAL_RATE = 1.5, SHORT_MAX_SHARES = 5000, OPTION_PREMIUM = 10000, OPTION_MULTIPLIER = 500, OPTION_MAX_CONTRACTS = 5, OPTION_TERM = 3, LOAN_SIZE = 100000, LOAN_MAX_COUNT = 3, LOAN_INTEREST = 0.03;
function shortCollateral(player, room) { return (player.shorts || []).reduce((sum, count, i) => sum + count * room.prices[i] * SHORT_COLLATERAL_RATE, 0); }
function optionIntrinsic(option, prices) { return Math.max(0, option.type === 'call' ? prices[option.stock] - option.strike : option.strike - prices[option.stock]) * OPTION_MULTIPLIER * option.contracts; }
function financialAction(ws, m) {
  const [room, player] = getPlayer(ws, m, true); if (!room || !player) return error(ws, 'Join a room first.');
  if (room.gameMode !== 'advanced') return error(ws, 'This room is using Classic mode. The host can enable Advanced Market when creating a room.');
  if (room.phase !== 'trade') return error(ws, 'Shorts, options, and loans are available between rounds.');
    player.shorts ||= Array(6).fill(0); player.shortProceeds ||= Array(6).fill(0); player.assetRealized ||= Array(6).fill(0); player.options ||= []; player.loanBalance ||= 0; player.loanCount ||= 0;
  const stock = Number(m.stock), lots = Number(m.lots || 1), contracts = Number(m.contracts || 1);
  if (m.type === 'short' || m.type === 'coverShort') {
    if (!Number.isInteger(stock) || stock < 0 || stock >= 6 || !Number.isInteger(lots) || lots < 1 || lots > 10) return error(ws, 'Choose a valid short position size.');
    const qty = lots * 500, price = room.prices[stock];
    if (m.type === 'short') {
      if (player.shorts[stock] + qty > SHORT_MAX_SHARES) return error(ws, 'Short positions are capped at 5,000 shares per sector.');
      if (player.cash < (player.shorts[stock] + qty) * price * SHORT_COLLATERAL_RATE) return error(ws, 'You need 150% cash collateral to open that short.');
      player.shorts[stock] += qty; player.shortProceeds[stock] += qty * price; player.cash += qty * price;
      activity(room,{kind:'short',playerId:player.id,playerName:player.name,asset:names[stock],ticker:tickers[stock],quantity:qty,price,round:room.round});
      log(room, `${player.name} shorted ${qty.toLocaleString()} ${names[stock]} shares at ${formatMoney(price)}. Collateral is reserved.`);
    } else {
      if (player.shorts[stock] < qty) return error(ws, 'You do not have that many short shares to cover.');
      const cost = qty * price;
      if (player.cash < cost) return error(ws, 'Not enough cash to cover that short. Take a loan or cover fewer shares.');
      const oldShorts=player.shorts[stock],proceeds=player.shortProceeds[stock]||0;player.assetRealized[stock]+=(oldShorts?proceeds*qty/oldShorts:0)-cost;player.shortProceeds[stock]=oldShorts?qty>=oldShorts?0:proceeds*(oldShorts-qty)/oldShorts:0;player.cash -= cost; player.shorts[stock] -= qty;
      activity(room,{kind:'cover',playerId:player.id,playerName:player.name,asset:names[stock],ticker:tickers[stock],quantity:qty,price,round:room.round});
      log(room, `${player.name} covered ${qty.toLocaleString()} ${names[stock]} short shares at ${formatMoney(price)}.`);
    }
    send(ws, { type: 'notice', message: `${m.type === 'short' ? 'Short opened' : 'Short covered'}: ${qty.toLocaleString()} ${names[stock]} shares.` });
  } else if (m.type === 'buyOption') {
    if (!Number.isInteger(stock) || stock < 0 || stock >= 6 || !['call','put'].includes(m.optionType) || !Number.isInteger(contracts) || contracts < 1 || contracts > OPTION_MAX_CONTRACTS) return error(ws, 'Choose a valid option.');
    if (player.options.reduce((sum,option)=>sum+option.contracts,0) + contracts > 10) return error(ws, 'You can hold up to 10 open option contracts.');
    const premium = OPTION_PREMIUM * contracts;
    if (player.cash - shortCollateral(player, room) < premium) return error(ws, 'Not enough free cash for that option premium.');
    player.cash -= premium;
    player.options.push({ stock, type: m.optionType, strike: room.prices[stock], contracts, premium: OPTION_PREMIUM, premiumTotal: premium, expiresRound: room.round + OPTION_TERM });
    activity(room,{kind:'option',playerId:player.id,playerName:player.name,asset:`${names[stock]} ${m.optionType.toUpperCase()} option`,ticker:tickers[stock],quantity:contracts,price:OPTION_PREMIUM,round:room.round});
    log(room, `${player.name} bought ${contracts} ${m.optionType.toUpperCase()} contract${contracts === 1 ? '' : 's'} on ${names[stock]}; $100 premium each, strike ${formatMoney(room.prices[stock])}, expires after round ${room.round + OPTION_TERM}.`);
    send(ws, { type: 'notice', message: `${contracts} ${m.optionType.toUpperCase()} option${contracts === 1 ? '' : 's'} bought for ${formatMoney(premium)} total.` });
  } else if (m.type === 'takeLoan') {
    if (player.loanCount >= LOAN_MAX_COUNT) return error(ws, 'You have reached the three-loan limit.');
    player.loanCount++; player.loanBalance += LOAN_SIZE; player.cash += LOAN_SIZE;
    activity(room,{kind:'loan',playerId:player.id,playerName:player.name,asset:'Took a $1,000 game loan',round:room.round});
    log(room, `${player.name} took a $1,000 loan. Interest is 3% each completed round.`);
    send(ws, { type: 'notice', message: 'Loan received: $1,000. Interest is 3% per round.' });
  } else if (m.type === 'repayLoan') {
    const amount = Math.min(50000, player.loanBalance, player.cash);
    if (amount <= 0) return error(ws, player.loanBalance ? 'You need at least $0.01 cash to repay.' : 'You have no loan balance.');
    player.cash -= amount; player.loanBalance -= amount;
    activity(room,{kind:'loan',playerId:player.id,playerName:player.name,asset:`Repaid ${formatMoney(amount)} of a game loan`,round:room.round});
    log(room, `${player.name} repaid ${formatMoney(amount)} of their loan.`);
    send(ws, { type: 'notice', message: `Repaid ${formatMoney(amount)}. Balance: ${formatMoney(player.loanBalance)}.` });
  }
  broadcast(room);
}
function formatMoney(cents) { return '$' + (cents / 100).toFixed(2); }
function botOpeningInvestment(room, bot) {
  const stock = randomInt(names.length), shares = 500, cost = room.prices[stock] * shares;
  bot.cash -= cost; bot.shares[stock] += shares; bot.shareBasis[stock]+=cost;
  activity(room,{kind:'buy',playerId:bot.id,playerName:bot.name,asset:names[stock],ticker:tickers[stock],quantity:shares,price:room.prices[stock],round:0});
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
    const t = weak[0],old=bot.shares[t.stock],basis=bot.shareBasis[t.stock]||0;bot.assetRealized[t.stock]+=(room.prices[t.stock]*500)-(old?basis*500/old:0);bot.shareBasis[t.stock]=old<=500?0:basis*(old-500)/old;bot.shares[t.stock] -= 500; bot.cash += room.prices[t.stock] * 500;
    activity(room,{kind:'sell',playerId:bot.id,playerName:bot.name,asset:names[t.stock],ticker:tickers[t.stock],quantity:500,price:room.prices[t.stock],round:room.round});log(room, `${bot.name} sold 500 ${names[t.stock]} shares (${bot.strategy} strategy).`); return;
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
    bot.cash -= price * 500 * bought; bot.shares[t.stock] += 500 * bought;bot.shareBasis[t.stock]+=price*500*bought;activity(room,{kind:'buy',playerId:bot.id,playerName:bot.name,asset:names[t.stock],ticker:tickers[t.stock],quantity:500*bought,price,round:room.round});
    room.purchases.push({ name: bot.name, stock: t.stock, shares: 500 * bought, price, round: room.round });
    log(room, `${bot.name} bought ${500 * bought} ${names[t.stock]} shares (${bot.difficulty} ${bot.strategy}).`);
  }
}
// Narrate the dice result as a Marketwire story. Headlines never move prices on their own.
function rollHeadline(room, rolledBy, roll) {
  const { stock, action, amount, priceBefore, priceAfter, split, crash, paid } = roll;
  const name = names[stock], upper = name.toUpperCase();
  let title, detail, impact;
  if (split) {
    title = `${upper} HITS $2 AND SPLITS IN TWO`;
    detail = `Holdings double and the price resets to $1.00. Shareholders feel exactly twice as smart.`;
    impact = `${name} +${amount}¢ · split · holdings doubled`;
  } else if (crash) {
    title = `${upper} HITS ZERO, SHAREHOLDERS HIT THE FLOOR`;
    detail = `Holdings are wiped out and the price resets to $1.00. Somebody check on the interns.`;
    impact = `${name} -${amount}¢ · crash · holdings wiped out`;
  } else {
    const pool = rollStories[action][stock];
    let story = pool[randomInt(pool.length)];
    if (pool.length > 1) while (story[0] === room.headline?.title) story = pool[randomInt(pool.length)];
    [title, detail] = story;
    if (action === 'dividend') {
      const belowPar = priceBefore < 100;
      if (belowPar) detail += ' Sadly the price is below par, so the check bounces. No payout.';
      impact = belowPar ? `${name} dividend ${amount}¢ · below par, no payout` : `${name} dividend ${amount}¢/share · ${formatMoney(paid)} paid`;
    } else {
      impact = `${name} ${action === 'up' ? '+' : '-'}${amount}¢ · ${formatMoney(priceBefore)} → ${formatMoney(priceAfter)}`;
    }
  }
  const size = action === 'dividend' ? 'DIVIDEND' : moveSizes[amount] || 'BREAKING';
  room.headline = { id: randomUUID(), title, detail, impacts: [impact], affected: [stock], size, action, round: room.round, playerId: rolledBy?.id || null, playerName: rolledBy?.name || null };
  room.headlines = [room.headline, ...(room.headlines || [])].slice(0, 200);
  activity(room, { kind: 'market', playerId: rolledBy?.id || null, playerName: rolledBy?.name || null, asset: title, assetName: detail, affected: [stock], impacts: [impact], round: room.round });
  log(room, `📰 ${title} — ${detail}`);
}
function recordHistory(room) {
  room.prices.forEach((price, i) => {
    room.history[i].push(price);
    if (room.history[i].length > 200) room.history[i].shift();
  });
  const prices=etfPrices(room);prices.forEach((price,i)=>{room.etfHistory||=Array.from({length:5},()=>[100]);room.etfHistory[i].push(price);if(room.etfHistory[i].length>200)room.etfHistory[i].shift()});
}
function settleOptions(room, all = false) {
  for (const player of room.players) {
    player.options ||= [];
    const keep=[];
    for (const option of player.options) {
      if (!all && option.expiresRound > room.round) { keep.push(option); continue; }
      const payout=optionIntrinsic(option,room.prices);player.cash+=payout;
      player.assetRealized[option.stock]=(player.assetRealized[option.stock]||0)+payout-(option.premiumTotal??option.premium*option.contracts);
      log(room, `${player.name}'s ${option.type.toUpperCase()} on ${names[option.stock]} expired${payout ? ` · paid ${formatMoney(payout)}` : ' worthless'}.`);
    }
    player.options=keep;
  }
}
function chargeLoanInterest(room) {
  for(const player of room.players) if(player.loanBalance>0){const interest=Math.ceil(player.loanBalance*LOAN_INTEREST);player.loanBalance+=interest;log(room,`${player.name}'s loan accrued ${formatMoney(interest)} interest.`)}
}
function maintainShortMargin(room) {
  for(const player of room.players){
    player.shorts ||= Array(6).fill(0);
    while(player.cash+1<shortCollateral(player,room)){
      const stock=player.shorts.findIndex(count=>count>=500);if(stock<0)break;
      const cover=500,cost=cover*room.prices[stock];if(player.cash<cost)break;
      const old=player.shorts[stock],proceeds=player.shortProceeds?.[stock]||0;player.assetRealized[stock]=(player.assetRealized[stock]||0)+(old?proceeds*cover/old:0)-cost;if(player.shortProceeds)player.shortProceeds[stock]=old<=cover?0:proceeds*(old-cover)/old;player.cash-=cost;player.shorts[stock]-=cover;
      log(room,`${player.name}'s ${names[stock]} short was reduced by a 500-share margin cover.`);
    }
  }
}
function resolveRoll(room, player) {
  const dice = [randomInt(1,7),randomInt(1,7),randomInt(1,7)];
  const stock = dice[0]-1, action = dice[1]<=2?'up':dice[1]<=4?'down':'dividend', amount = [5,5,10,10,20,20][dice[2]-1];
  const stockName = names[stock], priceBefore = room.prices[stock];
  room.lastMoves = Array(6).fill(0); room.lastRoll = null;
  let dividends=[], paid = 0, split = false, crash = false;
  if (action === 'dividend') {
    if (room.prices[stock] >= 100) for (const p of room.players) { const dividend = p.shares[stock] * amount; p.cash += dividend; p.dividendsTotal = (p.dividendsTotal || 0) + dividend; p.assetRealized ||= Array(6).fill(0);p.assetRealized[stock]+=dividend;paid += dividend;dividends.push({playerId:p.id,playerName:p.name,amount:dividend});if(dividend>0)activity(room,{kind:'dividend',playerId:p.id,playerName:p.name,asset:stockName,quantity:amount,price:dividend,round:room.round}); }
    room.last = room.prices[stock] >= 100 ? `${stockName} paid ${amount}¢ per share · ${formatMoney(paid)} total dividends.` : `${stockName} dividend declared at ${amount}¢ per share · price below par, no payout.`;
    log(room, room.last);
  } else {
    const old = room.prices[stock], priceDelta = action === 'up' ? amount : -amount; room.prices[stock] += priceDelta; room.lastMoves[stock] += priceDelta;
    let event = `${stockName} ${action} ${amount}¢: ${formatMoney(old)} → ${formatMoney(room.prices[stock])}`;
    if (room.prices[stock] >= 200) { for (const p of room.players) { p.shares[stock] *= 2; p.shorts ||= Array(6).fill(0);p.shortProceeds ||= Array(6).fill(0); p.shorts[stock] *= 2; for(const option of p.options||[])if(option.stock===stock){option.strike=Math.round(option.strike/2);option.contracts*=2} } room.prices[stock] = 100; split = true; event += ' · split; holdings doubled and price reset to par.'; }
    else if (room.prices[stock] <= 0) { for (const p of room.players) { p.assetRealized ||= Array(6).fill(0);p.assetRealized[stock]-=p.shareBasis?.[stock]||0;p.shareBasis ||= Array(6).fill(0);p.shareBasis[stock]=0;p.shares[stock] = 0; p.shorts ||= Array(6).fill(0);p.shortProceeds ||= Array(6).fill(0);p.assetRealized[stock]+=p.shortProceeds[stock]||0;p.shorts[stock]=0;p.shortProceeds[stock]=0;p.options=(p.options||[]).filter(option=>{if(option.stock!==stock)return true;const payout=option.type==='put'?option.strike*OPTION_MULTIPLIER*option.contracts:0;p.cash+=payout;p.assetRealized[stock]+=payout-(option.premiumTotal??option.premium*option.contracts);log(room,`${p.name}'s ${option.type.toUpperCase()} on ${names[stock]} settled on the crash${payout?` · paid ${formatMoney(payout)}`:' worthless'}.`);return false}) } room.prices[stock] = 100; crash = true; event += ' · crash; shares wiped out and price reset to par.'; }
    room.last = event; log(room, event);
  }
  const rollSummary = room.last, dicePriceAfter = room.prices[stock];
  const rollsLeft = (room.rollsLeft || room.rollsPerTurn || 1) - 1;
  if (rollsLeft > 0) room.rollsLeft = rollsLeft;
  else { room.turn++; room.rollsLeft = room.rollsPerTurn || 1; }
  rollHeadline(room, player, { stock, action, amount, priceBefore, priceAfter: room.prices[stock], split, crash, paid });
  room.lastRoll = { id:randomUUID(), rollerId:player.id, rollerName:player.name, dice, stock, action, amount, priceBefore, dicePriceAfter, priceAfter:room.prices[stock], message:rollSummary, dividends, headline:room.headline?.title||'' };
  recordHistory(room);
  if (room.turn >= room.players.length) {
    room.turn = 0;
    if(room.gameMode==='advanced'){chargeLoanInterest(room);settleOptions(room);maintainShortMargin(room)}
    if (room.round >= room.max) {
      settleOptions(room,true);
      room.phase = 'done'; room.players.sort((a,b) => netWorth(b, room) - netWorth(a, room));
      room.last = 'Closing bell! Final portfolios are ranked.'; log(room, room.last);
    } else {
      room.phase = 'trade'; room.readyIds = []; room.last += ' Trading is now open. Ready up when you are done trading.';
      for (const bot of room.players.filter(p => p.isBot)) botTrade(room, bot);
    }
  }
  if(room.last&&!room.last.startsWith('Marketwire:'))activity(room,{kind:'market',asset:room.last,assetName:`${player.name} completed a turn`,round:room.round});
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
function startNextRound(room) {
  room.round++; room.turn = 0; room.rollsLeft = room.rollsPerTurn || 1; room.readyIds = []; room.phase = 'playing';
  room.last = `Round ${room.round} begins.`; log(room, room.last); roundValues(room);
  activity(room, { kind: 'market', asset: room.last, round: room.round });
  broadcast(room);
  if (room.players[room.turn]?.isBot) scheduleBotTurn(room);
}
function isInvested(p) { return p.shares.some(Boolean) || !!p.etfShares?.some(Boolean); }
function openMarket(room) {
  room.phase = 'playing'; room.round = 1; room.turn = 0; room.rollsLeft = room.rollsPerTurn || 1; room.readyIds = []; roundValues(room);
  room.last = 'Opening bell! Everyone is invested.'; log(room, 'The opening bell rang. The first player is up.');
  broadcast(room);
  if (room.players[room.turn]?.isBot) scheduleBotTurn(room);
}
// Bots and offline players never block the round; every online human must ready up
// (and during opening buys, must own at least one lot).
function startRoundIfAllReady(room) {
  if (!['setup', 'trade'].includes(room.phase)) return false;
  const ready = room.readyIds || [];
  const waiting = room.players.filter(p => !p.isBot && p.online && (!ready.includes(p.id) || (room.phase === 'setup' && !isInvested(p))));
  const anyoneReady = ready.some(id => room.players.some(p => p.id === id && p.online));
  if (waiting.length || !anyoneReady) return false;
  if (room.phase === 'setup') openMarket(room); else startNextRound(room);
  return true;
}
function roll(ws, m) {
  const [room, player] = getPlayer(ws, m, true); if (!room || !player) return error(ws, 'Join a room first.');
  if (room.phase !== 'playing') return error(ws, 'The market is not taking rolls right now.');
  const currentPlayer = room.players[room.turn];
  if (currentPlayer?.id !== player.id && !(player.id === room.hostId && currentPlayer && !currentPlayer.online)) return error(ws, 'Wait for your turn.');
  resolveRoll(room, player);
}
function netWorth(p, room) { return p.cash + p.shares.reduce((sum, count, i) => sum + count * room.prices[i], 0) - (p.shorts || []).reduce((sum,count,i)=>sum+count*room.prices[i],0) - (p.loanBalance || 0) + (p.options || []).reduce((sum,option)=>sum+optionIntrinsic(option,room.prices),0) + (p.etfShares||[]).reduce((sum,count,i)=>sum+count*etfPrices(room)[i],0); }
function handle(ws, m) {
  if (m.type === 'ping') return send(ws, { type: 'pong' });
  if (m.type === 'create') return addRoom(ws, m);
  if (m.type === 'join') return joinRoom(ws, m);
  if (m.type === 'reconnect') return reconnect(ws, m);
  if (m.type === 'addBot') return addBot(ws, m);
  if (m.type === 'addLocal') return addLocal(ws, m);
  if (m.type === 'removeLocal') return removeLocal(ws, m);
  if (m.type === 'rematch') return rematch(ws, m);
  if (m.type === 'start') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the room host can start the game.');
    if (room.phase !== 'lobby') return error(ws, 'The game has already started.');
    if (room.players.length < 2) return error(ws, 'At least two players are needed.');
    room.phase = 'setup'; room.readyIds = []; log(room, 'The host opened the market for opening investments. Buy, then ready up.');
    for (const bot of room.players.filter(p => p.isBot)) botOpeningInvestment(room, bot);
    broadcast(room); return;
  }
  if (m.type === 'trade') return buySell(ws, m);
  if (['short','coverShort','buyOption','takeLoan','repayLoan'].includes(m.type)) return financialAction(ws,m);
  if (m.type === 'roll') return roll(ws, m);
  if (m.type === 'settings') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the host can change game settings.');
    if (room.phase !== 'lobby') return error(ws, 'Settings are locked once the game starts.');
    const rolls = m.rollsPerTurn == null ? null : Number(m.rollsPerTurn);
    const rounds = m.rounds == null ? null : Number(m.rounds);
    if (rolls === null && rounds === null) return error(ws, 'Choose a setting to change.');
    if (rolls !== null && !ROLL_CHOICES.includes(rolls)) return error(ws, 'Choose 1, 3, 5, 7, 10 or 20 rolls per turn.');
    if (rounds !== null && !ROUND_CHOICES.includes(rounds)) return error(ws, 'Choose a 12, 20 or 30 round game.');
    if (rolls !== null) { room.rollsPerTurn = rolls; room.rollsLeft = rolls; log(room, `Each player will roll ${rolls} time${rolls === 1 ? '' : 's'} per turn.`); }
    if (rounds !== null) { room.max = rounds; log(room, `The game will last ${rounds} rounds.`); }
    broadcast(room); return;
  }
  if (m.type === 'ready') {
    const [room, player] = getPlayer(ws, m, true);
    if (!room || !player) return error(ws, 'Join a room first.');
    if (!['setup', 'trade'].includes(room.phase)) return error(ws, 'You can ready up while the market is open for trading.');
    if (room.phase === 'setup' && m.ready !== false && !isInvested(player)) return error(ws, 'Buy at least one 500-share lot before you ready up.');
    room.readyIds = (room.readyIds || []).filter(id => id !== player.id);
    if (m.ready !== false) room.readyIds.push(player.id);
    if (!startRoundIfAllReady(room)) broadcast(room);
    return;
  }
  if (m.type === 'nextRound') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the host can force the next round.');
    if (room.phase === 'setup') {
      if (!room.players.some(p => p.online && !p.isBot && isInvested(p))) return error(ws, 'At least one player needs to buy shares first.');
      openMarket(room); return;
    }
    if (room.phase !== 'trade') return error(ws, 'The next round is not ready yet.');
    startNextRound(room); return;
  }
  if (m.type === 'endGame') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the room host can end the game.');
    if (['lobby', 'done'].includes(room.phase)) return error(ws, 'There is no active game to end.');
    if(room.gameMode==='advanced')settleOptions(room,true);room.phase = 'done'; room.players.sort((a,b) => netWorth(b, room) - netWorth(a, room));
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
      player.online = false; player.socket = null; setSeatsOnline(room, player, false);
      if (room.hostId === player.id) scheduleHostHandoff(room, player);
      if (!startRoundIfAllReady(room)) broadcast(room);
    }
  });
});
await loadRooms();
process.on('SIGINT', () => { persistRooms().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { persistRooms().finally(() => process.exit(0)); });
httpServer.listen(port, '0.0.0.0', () => console.log(`Stock Ticker listening on ${port}`));
