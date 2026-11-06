# 0073 Bridge stays in the gateway, in its own folder

Superseded by 0074 where it places Bridge: the Aeolus app lives in its own repository. The boy-scout rule stands for the Bridge pages still in the gateway.

- Bridge stays in the gateway: same package, same release train (0049). Bridge is one client of the person ship (0052) behind the gateway's doors (MCP, A2A, WhatsApp); the doors and Bridge are two things in one package.
- Bridge has its own top-level folder in the gateway, behind a hard lint boundary: Bridge code does not import the doors' code, and the doors do not import Bridge's. What both need lives in a shared folder of the gateway, so a later move to its own package is cheap.
- Boy-scout rule: what exists now is not rewritten for the boundary; code is moved into the shape when a change touches it. Everything new is built in the shape, so no new code adds to the debt and each change only reduces it.
- Supersedes what 0048 ("the plugin that speaks MCP and A2A with the outside") and 0054 ("a basic page of its own") say about where Bridge lives; the rest of both stands.

Why: "Agreed, with a small modification: we dont rewrite what we have now, but we apply the boyscout principle: we adjust what we touch. I want to prevent a full rewrite with zero value." (Thomas, on keeping Bridge in the gateway and splitting inside it.)

Rejected: a separate package or train for Bridge now (a move with no value yet); one undivided gateway (Bridge has grown into a person's app, #265); a rewrite of the existing gateway code into the split.
