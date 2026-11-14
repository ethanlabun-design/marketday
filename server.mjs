import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.env.PORT || 3000);
const BUILD = '2026.11.14.10';
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
      room.players = room.players.filter(p => p && p.id && typeof p.name === 'string').slice(0, 6).map(p => ({ ...p, socket: null, online: false, isBot: !!p.isBot, shorts: Array.isArray(p.shorts) ? p.shorts : Array(6).fill(0), shortProceeds: Array.isArray(p.shortProceeds) ? p.shortProceeds : Array(6).fill(0), shareBasis: Array.isArray(p.shareBasis) ? p.shareBasis : (p.shares || Array(6).fill(0)).map((count,i)=>count*(room.prices?.[i]||100)), assetRealized: Array.isArray(p.assetRealized) ? p.assetRealized : Array(6).fill(0), options: Array.isArray(p.options) ? p.options : [], loanBalance: Number(p.loanBalance) || 0, loanCount: Number(p.loanCount) || 0 }));
      room.max = [12, 20, 30].includes(room.max) ? room.max : 12;
      room.prices = Array.isArray(room.prices) && room.prices.length === 6 ? room.prices : Array(6).fill(100);
      room.lastMoves = Array.isArray(room.lastMoves) && room.lastMoves.length === 6 ? room.lastMoves : Array(6).fill(0);
      room.history = Array.isArray(room.history) && room.history.length === 6 ? room.history : Array.from({ length: 6 }, () => [100]);
      room.events = Array.isArray(room.events) ? room.events.slice(0, 20) : [];
      room.activity = Array.isArray(room.activity) ? room.activity.slice(0,250) : [];
      room.headlines = Array.isArray(room.headlines) ? room.headlines.slice(0,200) : (room.headline?[room.headline]:[]);
      room.etfHistory = Array.isArray(room.etfHistory) ? room.etfHistory : Array.from({length:5},()=>[100]);
      for(const p of room.players){p.etfShares=Array.isArray(p.etfShares)?p.etfShares:Array(5).fill(0);p.etfBasis=Array.isArray(p.etfBasis)?p.etfBasis:Array(5).fill(0)}
      room.purchases = Array.isArray(room.purchases) ? room.purchases : [];
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
  { title: 'MEDICARE EXPANSION WINS A FINAL VOTE', detail: 'A larger public health budget improves the outlook for medical suppliers.', moves: [[5, 15], [4, 5]] },
  { title: 'AI AGENT TAKES OVER THE BACK OFFICE', detail: 'Investors cheer a productivity jump while unions and software vendors race to react.', moves: [[0, 15], [4, -5]] },
  { title: 'CHIPMAKER WARNS OF A PACKAGING BOTTLENECK', detail: 'The latest AI hardware rush meets a very physical supply-chain problem.', moves: [[0, -15], [3, 5]] },
  { title: 'CRYPTO WALLET BUG FREEZES A POPULAR TOKEN', detail: 'A software flaw sends traders searching for the exit and security firms into overtime.', moves: [[1, -20], [0, -5], [5, 5]] },
  { title: 'TOKENIZED TREASURIES DRAW BIG MONEY', detail: 'Blockchain fans discover that boring government debt can still attract a crowd.', moves: [[1, 15], [4, 5]] },
  { title: 'MORTGAGE RATES DIP AFTER INFLATION COOLS', detail: 'Home buyers return to the market and property shares catch a bid.', moves: [[2, 15], [4, -5]] },
  { title: 'MAJOR DEVELOPER DELAYS THREE PROJECTS', detail: 'Construction costs and cautious lenders put new buildings on hold.', moves: [[2, -15], [3, 5]] },
  { title: 'ALLIES SIGN A MULTIYEAR DEFENSE PACT', detail: 'Contractors celebrate a long runway of procurement orders.', moves: [[3, 15], [4, 10]] },
  { title: 'AUDIT FLAGS COST OVERRUNS IN ARMS PROGRAM', detail: 'A procurement review leaves contractors explaining their spreadsheets on live television.', moves: [[3, -15], [4, -5]] },
  { title: 'GOVERNMENT AWARDS A NATIONAL CLOUD CONTRACT', detail: 'Public agencies move more services online, boosting technology suppliers.', moves: [[4, 15], [0, 5]] },
  { title: 'COURT DELAYS A MAJOR PUBLIC WORKS PLAN', detail: 'Permits and paperwork keep contractors waiting another quarter.', moves: [[4, -15], [2, -5]] },
  { title: 'CLINICAL TRIAL SHOWS PROMISING EARLY DATA', detail: 'A small study creates outsized expectations across the biotech pipeline.', moves: [[5, 15], [0, 5]] },
  { title: 'HOSPITALS FACE A SHORTAGE OF GENERIC DRUGS', detail: 'Manufacturers scramble to fill orders as providers look for alternatives.', moves: [[5, 10], [4, 5], [2, -5]] },
  { title: 'NEW PRIVACY RULES FORCE A MODEL REDESIGN', detail: 'AI firms face compliance costs while medical data custodians get fresh attention.', moves: [[0, -10], [5, 5]] },
  { title: 'STABLECOIN BILL CLEARS A KEY VOTE', detail: 'Clearer rules invite institutions in, though traders still read the fine print.', moves: [[1, 15], [4, 5]] },
  { title: 'COMMERCIAL PROPERTY LENDER CUTS ITS OUTLOOK', detail: 'Refinancing worries spread from downtown offices to the wider real estate market.', moves: [[2, -15], [4, -5]] },
  { title: 'DRONE CONTRACTS EXPAND AFTER FIELD TESTS', detail: 'Modern defense budgets find room for a new generation of hardware.', moves: [[3, 15], [0, 5]] },
  { title: 'EMERGENCY SPENDING DEAL AVOIDS SHUTDOWN', detail: 'Agencies keep operating, and suppliers can finally send invoices with confidence.', moves: [[4, 15], [3, 5]] },
  { title: 'REGULATOR FAST-TRACKS A VACCINE REVIEW', detail: 'A faster review lifts hopes for medical makers and public health procurement.', moves: [[5, 15], [4, 5]] },
  { title: 'POWER PRICES JUMP AS DATA CENTERS EXPAND', detail: 'AI demand surges, but energy costs squeeze property operators and chip buyers.', moves: [[0, 10], [2, -5], [1, -5]] },
  { title: 'A MAJOR EXCHANGE ADDS ROUND-THE-CLOCK TRADING', detail: 'Liquidity improves, along with the number of people checking charts at 3 a.m.', moves: [[1, 15], [0, 5]] },
  { title: 'DEFENSE SPENDING REVIEW SHIFTS TO READINESS', detail: 'Maintenance and logistics firms edge out headline-grabbing weapons programs.', moves: [[3, 5], [4, 10]] },
  { title: 'PUBLIC HEALTH AGENCY SIGNS A SUPPLY DEAL', detail: 'A new procurement contract steadies demand for essential medical products.', moves: [[5, 10], [4, 10]] }
];
const freshPlayer = (name, id, isBot = false, difficulty = 'normal', strategy = 'trend') => ({ id, name, cash: 500000, shares: Array(6).fill(0), shareBasis: Array(6).fill(0), etfShares:Array(5).fill(0), etfBasis:Array(5).fill(0), shorts: Array(6).fill(0), shortProceeds: Array(6).fill(0), assetRealized: Array(6).fill(0), options: [], loanBalance: 0, loanCount: 0, online: !isBot, isBot, difficulty, strategy });

function publicState(room) {
  return {
    code: room.code, build: BUILD, revision: room.revision, hostId: room.hostId, phase: room.phase, round: room.round, max: room.max, gameMode: room.gameMode || 'classic',
    turn: room.turn, turnId: room.players[room.turn]?.id ?? null,
    prices: room.prices, history: room.history, lastMoves:room.lastMoves||Array(6).fill(0), lastRoll:room.lastRoll||null, headline: room.headline, headlines: room.headlines||[], last: room.last, events: room.events.slice(0, 20), activity: room.activity||[], etfs, etfPrices: etfPrices(room), etfHistory:room.etfHistory||[], tickers,
    sentiment: (()=>{const moves=(room.headline?.impacts||[]).map(x=>Number(String(x).match(/([+-]\d+)¢/)?.[1]||0));const score=moves.reduce((a,b)=>a+b,0);return {score,label:score>0?'Bullish':score<0?'Bearish':'Neutral'};})(),
    recap: room.phase === 'done' ? gameRecap(room) : null, banter: room.banter || marketBanter(room),
    leaderboard: [...room.players].sort((a,b)=>portfolioValue(b,room)-portfolioValue(a,room)).map((p,i)=>({id:p.id,place:i+1,value:portfolioValue(p,room),cash:p.cash,returns:portfolioValue(p,room)-500000,percent:(portfolioValue(p,room)-500000)/500000*100,roundChange:portfolioValue(p,room)-(room.roundStartValues?.[p.id]??portfolioValue(p,room))})),
    players: room.players.map(({ id, name, cash, shares, shareBasis, shorts, shortProceeds, assetRealized, options, loanBalance, loanCount, etfShares, etfBasis, online, isBot, difficulty, strategy }) => ({ id, name, cash, shares, shareBasis, shorts, shortProceeds, assetRealized, options, loanBalance, loanCount, etfShares:etfShares||Array(etfs.length).fill(0), etfBasis:etfBasis||Array(etfs.length).fill(0), online, isBot: !!isBot, difficulty, strategy, ready: shares.some(Boolean)||!!etfShares?.some(Boolean) }))
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
  const room = { code: roomCode(), revision: 0, hostId: '', phase: 'lobby', round: 0, lastMoves:Array(6).fill(0), lastRoll:null, max: [12,20,30].includes(Number(m.rounds)) ? Number(m.rounds) : 12, gameMode: m.gameMode === 'advanced' ? 'advanced' : 'classic', turn: 0, prices: Array(6).fill(100), history: Array.from({ length: 6 }, () => [100]), headline: null, headlines: [], last: '', events: [], activity: [], purchases: [], players: [], lastActivity: Date.now() };
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
  for (const player of room.players) { player.cash = 500000; player.shares = Array(6).fill(0); player.shareBasis = Array(6).fill(0);player.etfShares=Array(5).fill(0);player.etfBasis=Array(5).fill(0); player.shorts = Array(6).fill(0); player.shortProceeds = Array(6).fill(0); player.assetRealized = Array(6).fill(0); player.options = []; player.loanBalance = 0; player.loanCount = 0; player.online = player.isBot ? false : !!player.socket; }
  room.phase = 'lobby'; room.round = 0; room.turn = 0; room.prices = Array(6).fill(100);room.lastMoves=Array(6).fill(0);room.lastRoll=null;
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
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
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
  if (room.phase === 'setup' && room.players.every(p => p.shares.some(Boolean)||p.etfShares?.some(Boolean))) {
    room.phase = 'playing'; room.round = 1; room.turn = 0;roundValues(room);
    room.last = 'Opening bell! Everyone is invested.'; log(room, 'The opening bell rang. The first player is up.');
  }
  broadcast(room);
  send(ws, { type: 'notice', message: `${qty > 0 ? 'Bought' : 'Sold'} ${Math.abs(qty).toLocaleString()} ${names[stock]} shares at ${formatMoney(room.prices[stock])} per share.` });
}
const SHORT_COLLATERAL_RATE = 1.5, SHORT_MAX_SHARES = 5000, OPTION_PREMIUM = 10000, OPTION_MULTIPLIER = 500, OPTION_MAX_CONTRACTS = 5, OPTION_TERM = 3, LOAN_SIZE = 100000, LOAN_MAX_COUNT = 3, LOAN_INTEREST = 0.03;
function shortCollateral(player, room) { return (player.shorts || []).reduce((sum, count, i) => sum + count * room.prices[i] * SHORT_COLLATERAL_RATE, 0); }
function optionIntrinsic(option, prices) { return Math.max(0, option.type === 'call' ? prices[option.stock] - option.strike : option.strike - prices[option.stock]) * OPTION_MULTIPLIER * option.contracts; }
function financialAction(ws, m) {
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
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
function movePrice(room, stock, delta) {
  const before = room.prices[stock];
  room.prices[stock] += delta;
  room.lastMoves ||= Array(6).fill(0); room.lastMoves[stock] = (room.lastMoves[stock]||0) + delta;
  let result = `${names[stock]} ${delta > 0 ? '+' : ''}${delta}¢ · ${formatMoney(before)} → ${formatMoney(room.prices[stock])}`;
  if (room.prices[stock] >= 200) {
    for (const player of room.players) { player.shares[stock] *= 2; player.shorts ||= Array(6).fill(0); player.shortProceeds ||= Array(6).fill(0); player.shorts[stock] *= 2; for(const option of player.options||[])if(option.stock===stock){option.strike=Math.round(option.strike/2);option.contracts*=2} }
    room.prices[stock] = 100;
    result += ' · split, shares doubled';
  } else if (room.prices[stock] <= 0) {
    for (const player of room.players) { player.assetRealized ||= Array(6).fill(0);player.assetRealized[stock]-=player.shareBasis?.[stock]||0;player.shareBasis ||= Array(6).fill(0);player.shareBasis[stock]=0;player.shares[stock] = 0; player.shorts ||= Array(6).fill(0);player.shortProceeds ||= Array(6).fill(0);player.assetRealized[stock]+=player.shortProceeds[stock]||0;player.shorts[stock]=0;player.shortProceeds[stock]=0;player.options=(player.options||[]).filter(option=>{if(option.stock!==stock)return true;const payout=option.type==='put'?option.strike*OPTION_MULTIPLIER*option.contracts:0;player.cash+=payout;player.assetRealized[stock]+=payout-(option.premiumTotal??option.premium*option.contracts);log(room,`${player.name}'s ${option.type.toUpperCase()} on ${names[stock]} settled on the crash${payout?` · paid ${formatMoney(payout)}`:' worthless'}.`);return false}) }
    room.prices[stock] = 100;
    result += ' · crash, shares wiped out';
  }
  return result;
}
function applyHeadline(room, rolledBy = null) {
  let story = headlines[randomInt(headlines.length)];
  if(room.headline&&headlines.length>1)while(story.title===room.headline.title)story=headlines[randomInt(headlines.length)];
  // Publish every roll's headline while keeping cumulative headline influence
  // per round near the old one-headline-per-round balance.
  const impacts = story.moves.map(([stock, delta]) => movePrice(room, stock, Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / Math.max(1, room.players.length)))));
  room.headline = { id:randomUUID(), title: story.title, detail: story.detail, impacts, affected:story.moves.map(([stock])=>stock), round: room.round, playerId:rolledBy?.id||null, playerName:rolledBy?.name||null };
  room.headlines=[room.headline,...(room.headlines||[])].slice(0,200);
  activity(room,{kind:'market',playerId:rolledBy?.id||null,playerName:rolledBy?.name||null,asset:story.title,assetName:story.detail,affected:story.moves.map(([stock])=>stock),impacts,round:room.round});
  room.last = `Marketwire: ${story.title}`;
  log(room, `📰 ${story.title} — ${story.detail}`);
  impacts.forEach(impact => log(room, impact));
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
  let dividends=[];
  if (action === 'dividend') {
    let paid = 0;
    if (room.prices[stock] >= 100) for (const p of room.players) { const dividend = p.shares[stock] * amount; p.cash += dividend; p.assetRealized ||= Array(6).fill(0);p.assetRealized[stock]+=dividend;paid += dividend;dividends.push({playerId:p.id,playerName:p.name,amount:dividend});if(dividend>0)activity(room,{kind:'dividend',playerId:p.id,playerName:p.name,asset:stockName,quantity:amount,price:dividend,round:room.round}); }
    room.last = room.prices[stock] >= 100 ? `${stockName} paid ${amount}¢ per share · ${formatMoney(paid)} total dividends.` : `${stockName} dividend declared at ${amount}¢ per share · price below par, no payout.`;
    log(room, room.last);
  } else {
    const old = room.prices[stock], priceDelta = action === 'up' ? amount : -amount; room.prices[stock] += priceDelta; room.lastMoves[stock] += priceDelta;
    let event = `${stockName} ${action} ${amount}¢: ${formatMoney(old)} → ${formatMoney(room.prices[stock])}`;
    if (room.prices[stock] >= 200) { for (const p of room.players) { p.shares[stock] *= 2; p.shorts ||= Array(6).fill(0);p.shortProceeds ||= Array(6).fill(0); p.shorts[stock] *= 2; for(const option of p.options||[])if(option.stock===stock){option.strike=Math.round(option.strike/2);option.contracts*=2} } room.prices[stock] = 100; event += ' · split; holdings doubled and price reset to par.'; }
    else if (room.prices[stock] <= 0) { for (const p of room.players) { p.assetRealized ||= Array(6).fill(0);p.assetRealized[stock]-=p.shareBasis?.[stock]||0;p.shareBasis ||= Array(6).fill(0);p.shareBasis[stock]=0;p.shares[stock] = 0; p.shorts ||= Array(6).fill(0);p.shortProceeds ||= Array(6).fill(0);p.assetRealized[stock]+=p.shortProceeds[stock]||0;p.shorts[stock]=0;p.shortProceeds[stock]=0;p.options=(p.options||[]).filter(option=>{if(option.stock!==stock)return true;const payout=option.type==='put'?option.strike*OPTION_MULTIPLIER*option.contracts:0;p.cash+=payout;p.assetRealized[stock]+=payout-(option.premiumTotal??option.premium*option.contracts);log(room,`${p.name}'s ${option.type.toUpperCase()} on ${names[stock]} settled on the crash${payout?` · paid ${formatMoney(payout)}`:' worthless'}.`);return false}) } room.prices[stock] = 100; event += ' · crash; shares wiped out and price reset to par.'; }
    room.last = event; log(room, event);
  }
  const rollSummary = room.last, dicePriceAfter = room.prices[stock];
  room.turn++;
  applyHeadline(room,player);
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
      room.phase = 'trade'; room.last += ' Trading is now open.';
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
function roll(ws, m) {
  const [room, player] = getPlayer(ws, m); if (!room || !player) return error(ws, 'Join a room first.');
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
  if (['short','coverShort','buyOption','takeLoan','repayLoan'].includes(m.type)) return financialAction(ws,m);
  if (m.type === 'roll') return roll(ws, m);
  if (m.type === 'nextRound') {
    const [room, player] = getPlayer(ws, m);
    if (!room || !player || room.hostId !== player.id) return error(ws, 'Only the host can start the next round.');
    if (room.phase !== 'trade') return error(ws, 'The next round is not ready yet.');
    room.round++; room.turn = 0; room.phase = 'playing'; room.last = `Round ${room.round} begins.`; log(room, room.last);roundValues(room);activity(room,{kind:'market',asset:room.last,round:room.round});broadcast(room); return;
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
