# 0043 Core's surface

- Core Aeolus is the fleet server, its API and the fleet's admin console, for every Fleet manager as far as its scopes allow and for argo, nothing more.
- People act as their accounts (0057) and reach their person ships through their own app, a chat or the gateway, which crews it (0054). Core has no human surface beyond that console, and no page per person.
- Plugins serve their own pages, apart from the console, and check the actor's scopes, never whether it is argo: argo or the viewer with `console.session` (0012), a person by their account token (0058). The console links to them.
- The console's questions UI (0038) is frozen: it keeps working for argo and gets no new work, and it moves out of core later.

Why: "one organisation where a symbiosis of humans, apps and agents are interconnected". A human is an account, and messages through their person ship from whatever app suits them. Core stays the fleet, and every human interface is a client of its API.

Rejected: a page per person in core's console; micro frontends inside the console (a hosting contract for one frame); the console rendering every plugin.
