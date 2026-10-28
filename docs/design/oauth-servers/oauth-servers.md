# Outside MCP servers that take only an OAuth sign-in

Design for the gateway calling outside MCP servers that accept only the authorization code flow, where a human signs in and consents in a browser, such as Attio's hosted server `https://mcp.attio.com/mcp` ("Authentication is OAuth only", no API key). Docs only, first part: purpose, lessons, decisions and open questions.

## 1. Purpose

In Thomas's words (28 Oct 2026): "I would make a dedicated Aeolus account in attio ... problem is tracking, but this is core of our setups. We connect your apps, so this needs to work".

Today an outside MCP server's credential is none, a static bearer or OAuth client credentials (gateway README, `parties.approve`; `McpServerCredential`). A server that only takes a browser sign-in cannot be added, so it cannot join a fleet.

For whom: the approver who adds an outside MCP server to a fleet (an actor holding `gateway:approve`, 0056), and every ship that calls it through its proxy ship.

After this, they can:
1. Add an OAuth-only server such as Attio, where each person signs in to it once in a browser, as their own outside account, and consents.
2. Have every ship within reach call its tools as today, by a message to the proxy ship, with no session holding the outside credential.
3. Keep calling it for as long as the outside service allows, without a human signing in again while the grant holds.
4. Learn, as the right human, when the grant is lost, and sign in again; no call is lost meanwhile.
5. See which ship made which call, while the outside service sees which person each call is for.

Not the purpose:
- Outside MCP clients signing in to the gateway: built (gateway README, "MCP clients sign in").
- Passing a ship's or a person's own token to the outside server: MCP forbids token passthrough (L4).
- Outside A2A agents behind an OAuth sign-in: the same question, a later design once this one holds.
- Changing what the outside service records in its own audit log: the gateway cannot.
- Rights travelling with a message: the outside account's rights never become fleet scopes, and fleet scopes never widen the outside account's (interop, "No rights travel with a message").

## 2. Lessons to check against

### The MCP authorization spec, client side (2026-07-28)

| # | Lesson | Source |
| --- | --- | --- |
| L1 | A client finds the authorization server from the 401's `WWW-Authenticate` `resource_metadata`, else `/.well-known/oauth-protected-resource`, then RFC 8414 or OIDC metadata, and checks the `issuer` matches. | [Authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery) |
| L2 | A client gets a client id in this order: pre-registered, then a client ID metadata document (CIMD) where `client_id_metadata_document_supported`, then dynamic registration (RFC 7591, MAY and marked deprecated), then ask the user. | [Client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) |
| L3 | Client credentials are bound to the issuer that issued them and never used with another. | Client registration, "Authorization Server Binding" |
| L4 | A client never sends a server a token not issued for it; a server never passes its inbound token on. | [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), "Token Handling"; security considerations, "Access Token Privilege Restriction" |
| L5 | PKCE with S256 is required, and a client refuses an authorization server that does not state it. `resource` (RFC 8707) goes in both the authorize and the token request. The client checks `iss` (RFC 9207) before redeeming the code, and uses and checks `state`. | Authorization, "Resource Parameter Implementation", "Authorization Response Validation"; security considerations |
| L6 | Scopes: the 401's `scope` if given, else all of `scopes_supported`. On `insufficient_scope` a client acting for a user asks again for the union, with retry limits. | Authorization, "Scope Selection Strategy", "Step-Up Authorization Flow" |
| L7 | Refresh tokens are kept confidential in storage and transit, never assumed to be issued; `offline_access` may be asked when listed. The authorization server must rotate them for public clients. | Authorization, "Refresh Tokens"; security considerations, "Token Theft" |
| L8 | The spec neither allows nor forbids a long-running server using a grant a human gave once; a confidential client holding a refresh token is the fit. Client credentials and enterprise-managed authorization (ID-JAG) are the non-interactive extensions, and need the outside service to support them. | Authorization, "Refresh Tokens"; [ext-auth](https://github.com/modelcontextprotocol/ext-auth) |
| L9 | A proxy using one static client id for many users must get consent per client before forwarding to a third-party authorization server (confused deputy). | Security considerations, "Confused Deputy Problem" |

### Attio, the first such server (read 28 Oct 2026)

| # | Lesson | Source |
| --- | --- | --- |
| L10 | Attio's protected resource names `https://app.attio.com` as authorization server, scopes `mcp`, `offline_access`, `openid`. Its metadata offers dynamic registration (`https://app.attio.com/oauth/register`), no CIMD, `authorization_code` and `refresh_token`, PKCE S256, client auth `none` or `client_secret_post`, and no `iss` in the response. | [PRM](https://mcp.attio.com/.well-known/oauth-protected-resource); [AS metadata](https://mcp.attio.com/.well-known/oauth-authorization-server) |
| L11 | Attio MCP acts with "the same permissions as your Attio user account"; sessions are revoked in the account's settings. | [Attio MCP overview](https://docs.attio.com/mcp/overview.md) |
| L12 | Attio's actors are `workspace-member`, `api-token` and `system`; every MCP call of a shared account records that one member. Whether it says "via" an app is not documented. | [Actors](https://docs.attio.com/docs/actors.md) |
| L13 | Attio's REST tokens "do not currently expire"; refresh token lifetime and rotation for MCP are not documented, so the gateway cannot rely on either. | [Identify](https://docs.attio.com/rest-api/endpoint-reference/meta/identify.md); [Token](https://docs.attio.com/docs/oauth/token.md) |

### Comparable products

| # | Lesson | Source |
| --- | --- | --- |
| L14 | Products split into one shared grant owned by one human (Zapier, Make, n8n, Workato's parent connection, Copilot Studio's "agent author authentication") and a grant per user (Claude and ChatGPT org connectors, Copilot Studio's "user authentication", Composio, Arcade, Pipedream Connect). Only per-user grants show the causing person in the outside service's own audit. | [Claude connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp); [Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication); [Zapier](https://help.zapier.com/hc/en-us/articles/8496290788109); [Composio](https://docs.composio.dev/docs/authentication) |
| L15 | No shared-grant product documents tracing a call to the agent or user that caused it; that trace is the caller's own log. | Same sources (absence) |
| L16 | Lost grant: Zapier's owner clicks Reconnect and keeps the same outside account; Composio marks the account `EXPIRED`, fires a webhook and sends a new link; Copilot Studio shows a Connect card and retries after consent; Claude Code refreshes on 401, retries once, then asks for re-authentication. | Zapier; Composio; Copilot Studio; [Claude Code MCP](https://code.claude.com/docs/en/mcp) |
| L17 | Headless agents cannot run the browser step: Claude Code's `-p` and Agent SDK sessions must sign in from an interactive session first. The human step is always outside the agent. | Claude Code MCP |
| L18 | Re-consenting must need a right to change the grant, not read it: n8n's CVE-2026-45732 let a read-only user reconnect a shared OAuth credential. | [OSV CVE-2026-45732](https://osv.dev/vulnerability/CVE-2026-45732) |
| L19 | Rotating refresh tokens (Slack, Salesforce RTR) invalidate the old token on use: a client stores the newest one before using it and refreshes one at a time, or loses the grant in a race. | [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation); [Salesforce ECA](https://developer.salesforce.com/docs/atlas.en-us.packagingGuide.meta/packagingGuide/secure_code_ac_eca.htm) |
| L20 | Grants die by policy, not only by revocation: Google's refresh tokens end after 7 days for an app in Testing, after 6 months unused, and the oldest goes silently past 100 per account and client. | [Google OAuth](https://developers.google.com/identity/protocols/oauth2) |
| L21 | OAuth security BCP: public clients' refresh tokens must be rotated or sender-constrained; a confidential client's are bound to its client authentication. | [RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700), 2.2.2 |

### The fleet's own rules

| # | Lesson | Source |
| --- | --- | --- |
| L22 | An outside MCP server is an outside party with a proxy ship of kind `app`, whose owner is a person ship and core's alone; an actor holding `gateway:approve` adds it, granting only scopes it holds. | [0056](../../decisions/0056-outside-parties.md); [0044](../../decisions/0044-ship-kinds.md); [0045](../../decisions/0045-owners.md) |
| L23 | A server never asks: an approver adds it, also when a person asked for it with `aeolus_ask_for_server`. Approving is ordinary work and never goes to argo; argo is the fail-safe, never a normal path. | 0056; [0057](../../decisions/0057-actors.md); [0012](../../decisions/0012-operator-is-a-ship.md) |
| L24 | No rights travel with a message; the outside server sees the gateway's credential, never the asker's. The gateway holds outside credentials and proxy ships' crew tokens; no session does. | interop, "No rights travel with a message", "Contained access" (branch `design/interop`); gateway `src/core/vault/credential.ts` |
| L25 | The gateway keeps outside credentials as they are in its own database: a key on the same server would protect only backups. | gateway README, "Parties" |
| L26 | Every call is a message from the asking ship to the proxy ship, stored before the send returns OK, with its sender in core's history; the gateway keeps each call, so a restart never calls again what may have run. | blueprint, "Guaranteed communication"; gateway README, "MCP out" |
| L27 | A call the server never got, unreachable or refusing the credential, is handed again after a wait and stopped at the fifth attempt; one that may have run is reported not handled for a human. | gateway README, "MCP out"; [0040](../../decisions/0040-delivery-protocol.md) |
| L28 | A question for a human goes to a ship's owner (0038); the person who asked for a server hears the outcome as a message to their person ship. | [0038](../../decisions/0038-questions.md); 0056 |
| L29 | Each tool of a server has a switch per party; what the outside account may do is wider than what the fleet switches on. | gateway README, tool switches (aeolus-fleet#1151) |
| L30 | The gateway writes what it checked about a proxy ship as verified facts (`tlsHost`, an issuer for an OAuth subject), never a credential. | [0059](../../decisions/0059-verified-facts.md) |
| L31 | Every event names its actor; events and messages go with the fleet's retention. | 0057; [0066](../../decisions/0066-retention.md) |
| L32 | Domain language: "connect" is only argo connecting a plugin; a human logs in with a sign-in; an IdP login is an identity. | [0050](../../decisions/0050-domain-language.md) |
| L33 | Before 1.0.0: minimal designs, no paid-product polish for zero customers. | [0013](../../decisions/0013-breaking-changes-before-1-0.md) |

## 3. Decisions

Thomas's answers to the first questions. The ids stay those of the questions, so section 4 can point to them.

- **Q1 Whose identity the calls carry: a grant per person.** Each person signs in to the outside service as their own outside account, and a ship's call goes out under the grant of the person who answers for it. Why: "This is the building block type of work that would allow us to sell actual value pieces" (Thomas). It is the per-user model of L14, the only one where the outside service's own audit shows the causing person.
- **Q2 Tracking: one outside account per person.** The outside service records each call as the person's own outside account, so its own audit names them (L12, L14); core's history still names the asking ship (L26). Rejected: the fleet's own record as the only trace, and stamping the asking ship's name into the outside call.
- **Q3 Where a person signs in: on the gateway's page for the server.** The page that adds a server is also where each person signs in for themselves, sent to the outside service and back. Rejected: a link to a human the approver names; argo only.
- **Q8 Outside scopes: the spec's default.** The 401's `scope`, else all `scopes_supported`, adding `offline_access` and `openid` when listed (L6, L10). The tool switches narrow what ships reach (L29). Rejected: the approver picking scopes.

## 4. Open questions

Q4 and Q7 stand, now per person's grant. Q5 and Q6 change: a lost grant is one person's, not the party's. Q9 to Q13 are new with per-person grants. Every ship has an owner, a person ship or argo, and a person ship owns itself (0045); "the person" for a call below is the owner of the asking ship.

4. **How does the gateway register as a client with the outside authorization server?** (stands)
   Context: the spec's order is pre-registered, CIMD, dynamic registration (L2); Attio offers only dynamic registration (L10). Client credentials are bound to their issuer (L3). With per-person grants each person consents to the client themselves, which is the per-client consent L9 asks for.
   Options: (a) the spec's order, with CIMD at one document the gateway serves and dynamic registration once per issuer per gateway installation; (b) the same, but dynamic registration once per party, every person's grant under that party's client; (c) pre-registered only, the approver pasting a client id and secret.
   Pick: (b). A client per party keeps one fleet's grants apart from another's when a party is retired or its client revoked at the outside service, and the consent screen each person sees names the party. CIMD comes when the first server offers it.

5. **What does a call do when its person has no usable grant?** (changes: covers both a lost grant and no sign-in yet)
   Context: a person may not have signed in yet (Q9), or their grant was lost: a refresh answered `invalid_grant`, revoked, or ended unused (L16, L20). Only that person can fix it, and maybe never will. Today a refused credential is handed again and stops at the fifth attempt (L27). Stopping the whole party, as the shared-grant pick did, would block every other person's calls.
   Options: (a) the gateway answers the call at once with an error result naming the missing sign-in and the page to sign in on; the person is told as in Q6; (b) the gateway keeps the call and makes it once the person signs in, for as long as the fleet's retention allows; (c) today's rule, handed again and stopped at the fifth attempt.
   Pick: (a). Every call is answered, so none is lost, and the asking ship learns the cause at once and can wait, tell its owner or do other work. (b) holds a call for a human who may never come, out of the asking ship's sight; (c) fails late for a cause no retry fixes.

6. **Who is told that a person has no usable grant, and who may sign in or remove a grant?** (changes)
   Context: the earlier pick told the proxy ship's owner and let any approver sign in again. A person's grant is now theirs alone: nobody can sign in as another person's outside account. Re-consent must need a right to change the grant (L18). A leaver's grants must stop (0057, the installation releases a leaver).
   Options: (a) the person is told once per party, by a message from the gateway's ship to their person ship with the page's link, again only after a sign-in in between; only the person signs in or removes their own grant; an actor holding `gateway:approve` within manage reach of the proxy ship may also remove any person's grant; a person's grants go when their person ship is retired; (b) as (a), but only the person ever removes their grant; (c) as (a), and the proxy ship's owner is also told of every lost grant.
   Pick: (a). The person is the only one who can act, so they are told; one message per loss is no flood. An approver removing a grant is how a party is cut off for one person without retiring it, and retiring the person ship ends a leaver's grants with the rest of their access. (c) sends the owner work they cannot do.

7. **Does the gateway keep an unused grant alive?** (stands, per grant)
   Context: refresh tokens may end unused (L20) and may rotate (L19); Attio documents neither (L13). There is now one grant per person per party.
   Options: (a) refresh ahead of the access token's expiry and also on a schedule while the grant is idle, one refresh at a time per grant, the new refresh token stored before it is used; (b) refresh only when a call needs it.
   Pick: (a). A person who calls rarely stays signed in, and a refresh that fails is found before a call needs it, so Q6's message reaches the person early.

9. **When does a person sign in?** (new)
   Context: Q3 places the sign-in on the gateway's page for the server. The headless agent that makes the call cannot run the browser step (L17).
   Options: (a) only on the page, whenever the person chooses; (b) also at first need: the first call without a usable grant sends the person, as in Q6, a message with the page's link; (c) the approver adding a server also invites every person in reach to sign in.
   Pick: (b). The page is the one place to sign in, and the message at first need tells the right person at the moment it matters, with nothing sent to people who never use the server. (c) messages people who may never need it.

10. **May a ship owned by argo call such a server?** (new)
   Context: a ship with no person behind it has argo as owner: plugin and trierarch ships, and agent ships commissioned with no person (0045). argo is the fail-safe, never a normal path (0057), and Q1 turned away one shared grant.
   Options: (a) no: its call is answered with an error result saying the ship has no person who can sign in, and it calls once a person owns it (`fleet.setOwner`); (b) argo signs in once as a shared outside account for every ship it owns; (c) the approver names, per party, a person whose grant argo's ships use.
   Pick: (a). Every call then carries a real person's outside account, as Q2 decided; (b) routes ordinary work through argo and brings back the shared account; (c) lets one person's outside rights act for ships they never answer for.

11. **Does a person's grant serve every ship they own?** (new)
   Context: the owner answers for a ship (0045), and squadrons names the forming ship's owner for its members (0017). What a ship may call is already gated by reach and the party's tool switches (L29).
   Options: (a) yes: every ship the person owns, their person ship included, calls under their grant, within reach and the tool switches; a change of owner moves a ship to the new owner's grant from its next call; (b) the person picks, on the page, which of their ships may use their grant.
   Pick: (a). Ownership already says who answers for a ship; a second list per person and party is process the fleet does not need yet (L33).

12. **Who sees which person's grant?** (new)
   Context: the gateway holds each grant (L24, L25). The outside account a person signed in as (its `openid` subject, L10) shows whether the right account consented. Verified facts are one per writer and ship (0059), so per-person subjects do not fit there; the proxy ship's facts keep the issuer.
   Options: (a) each person sees their own grant on the page: outside account, when signed in, last used, state; every actor holding `gateway:approve` within manage reach of the proxy ship sees the list of all of them, never a token; (b) each person sees only their own, and nobody sees the list.
   Pick: (a). An approver must see who is set up, and who is not, to remove a leaver's or a wrong grant (Q6); the list shows people and outside accounts, never a credential.

13. **May two persons sign in as the same outside account?** (new)
   Context: Q2 rests on each outside account being one person's. The gateway knows the outside account only where the server gives an `openid` subject (L10); otherwise it cannot tell.
   Options: (a) allowed, and the list (Q12) shows the shared outside account to approvers; (b) refused where the gateway can tell: the second sign-in is turned away with why; (c) allowed without a word.
   Pick: (b). A shared outside account is the shared grant Q1 turned away, and where the subject is known refusing costs nothing; where it is not known, the list shows what the gateway does know.
