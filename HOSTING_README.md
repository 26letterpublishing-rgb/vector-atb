# Vector ATB Hosting Notes

This prototype can be hosted online so the GM and players can connect from phones or computers on different networks.

## Current Scope

- GM-created four-character room codes.
- Separate GM and player interfaces.
- Player reconnect while the room is still active.
- Real-time Decision, Preparation, Execution, Recovery, Stagger, and Dumbfounded phases.
- Character-derived action rates, weapon recovery, movement, targeting, action queues, and Poise.
- In-memory encounter state only. If the server restarts or sleeps, active rooms reset.

## Deploying on Render

1. Put this folder in a GitHub repository.
2. In Render, choose `New` > `Web Service`.
3. Connect the GitHub repository.
4. Leave Root Directory blank when these files are at the repository root. Otherwise enter the folder containing `package.json`.
5. Use Runtime `Node`.
6. Use Build Command `npm install`.
7. Use Start Command `npm start`.
8. The free instance type is sufficient for a private playtest.
9. Deploy and share the resulting `onrender.com` address with the players.

The GM creates a room and gives its four-character code to the players. Everyone uses the same website address.

## Current Limitations

- No accounts, passwords, or private-room authentication.
- No permanent encounter storage.
- A server restart, redeploy, or free-instance sleep clears every room.
- The server is intended for private playtesting, not public unsupervised use.
