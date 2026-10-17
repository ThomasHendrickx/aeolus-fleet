# 0043 Core's surface

- Core Aeolus is the fleet server, its API and argo's admin console, nothing more.
- People reach their own ships through their own app or a chat, which crews the person's ship (0044) with its crew token. Core has no human surface beyond argo's console.
- Plugins serve their own pages, apart from the console, and check argo with `console.session` (0012). The console links to them.
- The console's questions UI (0038) is frozen: it keeps working for argo and gets no new work, and it moves out of core later.

Why: "one organisation where a symbiosis of humans, apps and agents are interconnected". A human is a ship, reached through whatever app suits them. Core stays the fleet, and every human interface is a client of its API.

Rejected: a page per person in core's console; micro frontends inside the console (a hosting contract for one frame); the console rendering every plugin.
