# Marketday project handoff for Claude Code

## What this project is

Marketday is a browser based, multiplayer stock market board game. The Node.js server serves `index.html` and manages game rooms over WebSockets (`ws`), with an HTTP room-state endpoint used for polling and reconnect recovery. The six fictional sectors are AI, Crypto, Real Estate, Defense, Government, and Medicine. Headlines move sector prices according to game rules; this is a game, not a real trading service.

## Run locally

- Requirements: Node.js 20 or newer.
- Install dependencies once with `npm install`.
- Start the server with `npm start`.
- Open `http://localhost:3000` (or the port printed by the server).
- `PORT` selects the HTTP port. `STOCK_TICKER_DATA` can point to a persistent room-data JSON file.

## Project map

- `server.mjs`: HTTP/WebSocket server, room persistence, game rules, trades, headlines, dice results, and public player state.
- `index.html`: full client UI, styles, inline browser JavaScript, stock chart, trade menu, activity feed, opponent portfolio inspection, and turn/dice feedback.
- `README.md`: setup, hosting, and game rules.
- `render.yaml`: Render deployment configuration.

## Current game/UI behavior

- Players create or join rooms by six digit code and nickname. Players may join an active game.
- Clicking a sector bar opens that sector's buy/sell menu. Stock symbols are not shown in the player UI.
- Market headlines are separate from the investor activity feed. The feed is meant to show actual completed player actions publicly.
- Opponent chips open a player's portfolio and holdings.
- Dice rolls publish the dice faces, the affected sector, the roll result, market headline, and dividend details.
- `Classic` is the default mode. `Advanced Market` adds shorts, options, and loans.

## Current working-tree handoff

The intended working folder is this repository clone in the user's OneDrive `Documents/marketday/marketday` folder. At handoff time, the recent Marketday UI/server changes were local and uncommitted, including edits to `README.md`, `index.html`, and `server.mjs`. The latest recorded local build marker is `2026.11.14.10`. A two-player WebSocket playthrough to 12 rounds was completed; room joins, public purchases, headline impacts, dice results, and dividends were checked. A visual browser screenshot was not confirmed in that session.

Before further changes, inspect `git status` and `git diff` so the existing local work is preserved. Do not reset, discard, commit, push, or deploy unless Ethan asks. The local preview has been run on port 3105; the normal `npm start` port is 3000.

## Useful checks

- Server syntax: `node --check server.mjs`
- Client code is inline in `index.html`; extract and parse its `<script>` block if changing browser logic.
- For multiplayer changes, verify with two connected players and confirm the second player's WebSocket receives the updated room state and activity.
- Keep room-code behavior and reconnect/poll fallback intact.
