# Stormpeak online co-op — local beta

Implemented: home-screen Host/Join and copyable invite, two-player rooms, separate level votes with a randomized winner, host-owned enemy simulation, replicated heroes/enemies/projectiles, guest attack damage, exclusive teleport reservations, separate blessings after waves 2/3/4, shared power-gem progress, potion collection, shared earned gold, independent guild purchases, and a wait-for-both guild exit. A downed player can be revived by a potion or the next wave; both downed ends the run. Either player's disconnection stops the shared run safely.

**Not deployed yet.** `online_config.json` deliberately has no public server address. This is a private-friends beta, not an anti-cheat server: the host owns enemies and guests submit locally calculated attack outcomes. The room service validates roles, phases, wave numbers, action ordering, membership, circle reservations and reward stack caps. It does not re-simulate every spell or own persistent inventories. No host migration/reconnection-in-place is supported.

The game uses ten world snapshots per second with positional smoothing. Region coordinates are normalized between different window sizes. Enemy assets are referenced from the same packaged game build, never downloaded from arbitrary URLs. Only the host spawns enemies and advances waves. Clients retain their own hero resources, unlocks, relics and purchases; run blessings are temporary. Both players should use the same build.

Local validation: `lobby.test.mjs`, `session.test.mjs`, and Godot `work/qa_online_session.gd` (two distinct viewports/clients and isolated QA saves). Native rendering checks catch visual differences that headless protocol tests cannot. Public launch still requires a browser build, a real two-machine latency/full-run playtest, and deployment configuration; native localhost tests are not proof of production network performance.

Run `npm install` then `npm test` or `npm start` in this folder. Start Godot with `STORMPEAK_COOP_URL=ws://127.0.0.1:10000` for local testing. Solo remains independent.

For deployment, use the root Render blueprint, then set `server_url` in the game's `online_config.json` to the actual `wss://` Render address. Set `invite_base_url` to the Netlify game URL for native clients; browsers automatically use their current origin/path. Include the JSON config in the Godot web export. No server URL is accepted from invite links. A room code grants access to a private room; don't post invites publicly.

Free hosting can sleep and may take longer than the client timeout to wake. Retry if needed. Before public promotion, add stronger edge-level connection/rate protections and test service restarts, slow clients, background browser tabs and every hero's attacks through a complete five-wave run.
