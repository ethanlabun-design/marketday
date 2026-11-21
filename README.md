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
- The host starts when at least two players have joined. Everyone buys an opening position in 500 share lots.
- Players take turns rolling. Marketwire draws one of 40 price-moving headlines after every roll.
- The market is a bar chart of the six sectors on a fixed $0–$2.00 axis. Tap a bar (or its label) to buy or sell that sector in its own order panel. A dashed par line marks $1.00; sectors below par are drawn darker and hatched with a "No dividend" tag because they pay no dividends. Splits double holdings at $2; crashes wipe holdings at $0.
- When another player buys, sells, shorts, covers, or buys options, everyone else gets an animated announcement card (for example "Ethan bought AI · 500 shares"). Tap a card or a player chip to see that player's net worth and holdings breakdown.
- If the host refreshes or briefly drops, they keep hosting. After 30 seconds offline another online player hosts temporarily, and the room creator takes hosting back when they return.
- Between rounds, tap a sector bar to open its individual order prompt. Choose a share quantity and buy or sell that sector there; no general trading screen is used. The host starts the next round. Your Desk shows net worth and an expandable breakdown of cash, sector positions, shorts, options, and debt.
- Investor activity is generated from joined players, completed trades, dice rolls, and the actual headlines applied to prices. The activity feed is shared across the room and retains the recent history; entries open the associated portfolio or market event.
- Marketwire’s price headlines describe actual sector moves. Investor activity is shown in a separate public feed; trades are not presented as market headlines.
- The personal portfolio breakdown includes cash, sector holdings, average cost, current value, profit or loss, and a sector allocation visualization. Portfolio values update for everyone from the room's shared state. The player leaderboard is not shown.
- The host can choose **Advanced Market** when creating a room. It is off by default, so Classic keeps the original rules. Advanced adds short selling (500-share lots, 150% collateral, margin covers), call and put options ($100 premium, at-the-money strike, three-round expiry), and loans ($1,000 each, up to three, 3% interest per completed round). Options expire for intrinsic value; the premium is the maximum loss. Loan balances and short liabilities count against final portfolio value.
- Play for 12, 20, or 30 rounds. The highest portfolio value wins. The host can reset the same room for a rematch after the final recap. Player reconnect details are stored per browser tab so multiple players in one browser stay separate.
