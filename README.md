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
- Players take turns rolling. At the end of each round, Marketwire draws a headline that moves one or more sectors.
- Invest across AI, Crypto, Real Estate, Defense, Government, and Medicine. Splits double holdings at $2; crashes wipe holdings at $0.
- Between rounds, every player can trade at current prices. The host starts the next round.
- Play for 12, 20, or 30 rounds. The highest portfolio value wins. The host can reset the same room for a rematch after the final recap. Player reconnect details are stored per browser tab so multiple players in one browser stay separate.
