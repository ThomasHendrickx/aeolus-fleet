# 0074 The Aeolus app lives in its own repository

- The Aeolus app (Bridge as an app) lives in the private repository ThomasHendrickx/aeolus-app, from its first build slice. It is no npm package: it builds and deploys as an app.
- It has its own origin, app.aeolus-fleet.dev. It may run in the same container as the gateway; its code base is apart.
- The gateway stays public, with its doors (MCP, A2A, WhatsApp).
- Existing Bridge pages stay in the gateway until the app replaces them. The boy-scout rule of 0073 stands for them.
- Supersedes where 0073 places Bridge; the rest of 0073 stands.

Why: "bridge needs to be made so it can be extracted. Since if pagasae is closed, I feel bridge is as well, and gateway is something that can be opened up. But bridge and gateway clearly are 2 seperate things. Might be that they can be the same container running it (no need to have always seperate images) but the code base feels like it should be." On packaging: "Why should it be an npm package? I dont get the reason why" and "It will live under app.aeolus-fleet.dev". (Thomas, on Bridge.)

Rejected: Bridge in its own folder inside the public gateway (0073: the app is closed, the gateway can be opened); an npm package for the app (nothing installs it); a separate image required for the app (one container may serve both).
