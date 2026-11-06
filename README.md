# Signal / Market

A lightweight live web game for 2–6 players. Share one invite URL; guests enter a nickname and join the room without an account or a separate PIN entry.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://localhost:3000` in multiple browser windows to play together on the same computer or network.

## Put it on the public web

The repository includes a Render Blueprint in `render.yaml`. Push the folder to a Git repository, then create a new Render Blueprint from that repository. Render builds with `npm install` and starts the web and WebSocket server with `npm start`. After deployment, share the app URL to host a game; the host can copy an invite link from the waiting room. Render web services accept public WebSocket connections, which the live game uses for synchronized updates.

This workspace does not have a hosting account or deployment credentials, so the app is ready to deploy but does not have a public URL yet. Rooms live in server memory and are cleared when the server restarts.

## Play

- The host enters a nickname, creates a room, and shares the invite link. Guests only enter a nickname from that link.
- The host starts when at least two players have joined. Everyone buys an opening position in 500 share lots.
- Players take turns rolling. At the end of each round, Marketwire draws a headline that moves one or more sectors.
- Invest across AI, Crypto, Real Estate, Defense, Government, and Medicine. Splits double holdings at $2; crashes wipe holdings at $0.
- Between rounds, every player can trade at current prices. The host starts the next round.
- Play for 12, 20, or 30 rounds. The highest portfolio value wins.
