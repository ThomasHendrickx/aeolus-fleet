# 0050 Domain language

- Each term has one meaning, defined in the blueprint's [Domain language](../blueprint.md#domain-language); other docs point there.
- Account: only a human's account in an organisation, in pagasae. The operator account and pagasae's account fold into it. A Google or Microsoft login is an identity, from an identity provider.
- Owner: only a ship's owner (0045). A label has a definer, the ship that defined it and may assign it. pagasae's owner is the installation admin.
- Session: only an agent run crewing a ship. Every human login is a sign-in: console, pagasae or gateway sign-in.
- Connect: only argo connecting a plugin to a fleet; the plugin's stored connection is the same relation. An account is linked to a person ship, or to a trierarch's app ship.
- Role: only a squadron member's role. No human has a role: a human's rights in a fleet are their ship's scopes.
- Operator: the human who signs in as argo. There is no operator account. Core's email and password for argo are argo's own sign-in, not an account.
- Organisation: pagasae's tenant (accounts, fleets, directory); the fleet stays core's tenant (0007). The principle reads "one organisation, many actors, across its fleets".
- Kinds, by lifecycle, never by power, rights coming only from scopes: `operator` (argo), `viewer`, `person` (a human, an account linked to it), `agent` (an AI session, commissioned, crewed by a trierarch or a harness), `app` (software in one fleet, commissioned: the trierarch, the gateway's proxy ships, own integrations), `plugin` (software installed once per installation serving many fleets: squadrons, the networking plugin, the trierarch plugin, the gateway; argo connecting it is its commission). The fleet-wide read on connect is a built-in rule for kind `plugin`, so connection and kind are one fact. Changes 0034 and 0044.
- The viewer keeps its name: the ship anyone with a viewer ticket signs in as, read-only. A named person who reads only gets a person ship with `fleet:read`.
- Outside party: an approved outside MCP server or client.
- Computer: the laptop or server a trierarch runs on. Never "machine".

Why: one word for one thing, read the same way by humans and by the agents that read the blueprint on every task.

Rejected: keeping the old meanings beside the new; new words for the old meanings; a role for humans; a kind defined by what a ship may do.
