# Spaceship Architect ATB Sync Hosting Notes

This prototype can be hosted online so phones can connect from any network.

## Current Scope

- One shared room per running server.
- Character Speed only.
- ATB fills from 0% to 100%.
- Speed is percent filled per second. Example: Speed 5 fills 5% per second and acts in about 20 seconds.
- No starships, recovery frames, cooldowns, login accounts, or permanent storage yet.
- If the hosting service restarts or sleeps, the encounter resets.

## Recommended First Host: Render

Render is a good first test because this app is a small Node web service.

High-level steps:

1. Put the `sa-atb-multiplayer` folder in a GitHub repository.
2. Create a Render account.
3. Choose `New` > `Web Service`.
4. Connect the GitHub repository.
5. If Render asks for the root directory, use:
   `sa-atb-multiplayer`
6. Use these settings:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
7. Deploy.
8. Render will give you an internet URL ending in `onrender.com`.

Players open that hosted URL on their phones. The GM opens the same URL and chooses GM View.

## Important Limitation

This is not yet a finished Jackbox-style room system. Right now, everyone who opens the hosted URL joins the same shared encounter. That is fine for one private playtest group, but later we should add:

- Real room codes.
- GM-created rooms.
- Player reconnect.
- Basic room passwords.
- Separate player-private information.
- A way to recover if the host restarts.
