# Signal / Market

A lightweight live web game for 2–6 players, including configurable bot opponents. Share one invite URL; guests enter a nickname and join without an account or separate PIN entry.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://localhost:3000` in multiple browser windows to play together on the same computer.

To play from a phone on the same Wi-Fi, run the server on your PC and open the PC's Wi-Fi IPv4 address with the same port (for example, `http://10.0.0.222:3000`). Find that address with `ipconfig` under **Wireless LAN adapter Wi-Fi → IPv4 Address**. The phone must be on the same Wi-Fi; `localhost` on the phone points back to the phone. If Windows Firewall asks, allow Node.js on **Private networks**. If it was blocked, use Windows Defender Firewall to allow inbound TCP on the port you chose. This local address is only for your home network; use the Render deployment instructions below for a public link.

## Put it on the public web

The repository includes a Render Blueprint in `render.yaml`. Push the folder to a Git repository, then create a new Render Blueprint from that repository. Render builds with `npm install` and starts the web and WebSocket server with `npm start`. After deployment, share the app URL to host a game; the host can copy an invite link from the waiting room. Render web services accept public WebSocket connections, which the live game uses for synchronized updates.

Rooms are saved atomically to `data/rooms.json`, restored after a server restart, and expire after seven days without activity. The server retains up to 200 recent rooms and is designed to run as a single instance. Set `STOCK_TICKER_DATA` to a path on a persistent disk when hosting somewhere that has an ephemeral filesystem; without a mounted disk, cloud restarts can still erase saved rooms.

## Play

- The host enters a nickname, creates a room, and shares the invite link. Guests only enter a nickname from that link.
- The host can add up to five bots before starting. Choose a Casual, Standard, or Sharp skill and a Trend follower, Value hunter, or Contrarian strategy. Bots invest, roll automatically on their turns, and trade between rounds.
- **Pass and play:** in the waiting room anyone can add extra players who share their screen (up to six seats in total, mixed freely with online players and bots). Local players sit next to the device owner in turn order. When it is a local player's turn, or their turn to trade during opening buys and between rounds, a full-screen "Pass the device to …" card appears; a **Playing as** bar in the side panel shows whose seat is active and lets you switch seats while trading. Local players go offline with their device and come back when it reconnects.
- In the waiting room the host sets two separate options: **Game length** (12, 20 or 30 rounds; also offered when creating the room) and **Dice rolls per turn** (1, 3, 5, 7, 10 or 20). Both lock when the game starts. The host starts when at least two players have joined.
- **Opening buys:** everyone buys an opening position in 500 share lots, as many lots as they like. You must own at least one lot before you can tap **Ready to open the market**; the market opens once every online player is ready, and the host can force it open.
- Players take turns rolling three dice: a **sector** die (which of the six sectors), an **amount** die (5¢, 10¢ or 20¢), and a **move** die (up, down or dividend). Only the dice move prices. After every roll Marketwire runs a story written for that exact result: the rolled sector, the direction, and a size tag (5¢ SMALL MOVE, 10¢ BIG MOVE, 20¢ HUGE MOVE), with special stories for dividends, below-par dividends, splits and crashes.
- When a dividend pays you, a gold notification shows the amount, and your portfolio keeps a running "Dividends received" total. If a dividend is rolled on a sector you own while it is below par, you get a "dividend skipped" notice instead.
- The market is a bar chart of the six sectors on a fixed $0–$2.00 axis. Tap a bar (or its label) to buy or sell that sector in its own order panel. A dashed par line marks $1.00; sectors below par are drawn darker and hatched with a "No dividend" tag because they pay no dividends. Splits double holdings at $2; crashes wipe holdings at $0.
- When another player buys, sells, shorts, covers, or buys options, everyone else gets an animated announcement card (for example "Ethan bought AI · 500 shares"). Tap a card or a player's name plate to see their net worth and holdings breakdown.
- The side panel combines your turn, the dice, live **standings** and investor activity. Name plates are ranked by net worth and slide into place when the lead changes. On a laptop-sized screen the whole game fits without page scrolling.
- If the host refreshes or briefly drops, they keep hosting. After 30 seconds offline another online player hosts temporarily, and the room creator takes hosting back when they return.
- Between rounds, tap a sector bar to open its individual order prompt. Choose a share quantity and buy or sell that sector there; no general trading screen is used. When you are done trading, tap **Ready for next round**; the round starts once every online player is ready (bots and offline players never block it). The host can force a start if someone wanders off.
- Investor activity is generated from joined players, completed trades, dice rolls, and the Marketwire stories for each roll. The activity feed is shared across the room and retains the recent history; entries open the associated portfolio or market event.
- Marketwire’s headlines narrate the dice roll that just happened. Investor activity is shown in a separate public feed; trades are not presented as market headlines.
- The personal portfolio breakdown includes cash, sector holdings, average cost, current value, profit or loss, and a sector allocation chart drawn as vertical bars in the same colors as the price board, with a cash bar and hatching for sectors below par. Portfolio values update for everyone from the room's shared state.
- The host can choose **Advanced Market** when creating a room. It is off by default, so Classic keeps the original rules. Advanced adds short selling (500-share lots, 150% collateral, margin covers), call and put options ($100 premium, at-the-money strike, three-round expiry), and loans ($1,000 each, up to three, 3% interest per completed round). Options expire for intrinsic value; the premium is the maximum loss. Loan balances and short liabilities count against final portfolio value.
- Play for 12, 20, or 30 rounds. The highest portfolio value wins. The final recap names the winner and shows medal standings; the host can start a rematch in the same room, and anyone can leave the room from there. Player reconnect details are stored per browser tab so multiple players in one browser stay separate.
