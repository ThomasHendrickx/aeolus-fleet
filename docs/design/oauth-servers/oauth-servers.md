# Outside MCP servers that take only an OAuth sign-in

Design for the gateway calling outside MCP servers that accept only the authorization code flow, where a human signs in and consents in a browser, such as Attio's hosted server `https://mcp.attio.com/mcp` ("Authentication is OAuth only", no API key). Docs only, first part: purpose, lessons and questions. No detailed decision is taken before Thomas agrees the purpose.

## 1. Purpose

In Thomas's words (28 Oct 2026): "I would make a dedicated Aeolus account in attio ... problem is tracking, but this is core of our setups. We connect your apps, so this needs to work".

Today an outside MCP server's credential is none, a static bearer or OAuth client credentials (gateway README, `parties.approve`; `McpServerCredential`). A server that only takes a browser sign-in cannot be added, so it cannot join a fleet.

For whom: the approver who adds an outside MCP server to a fleet (an actor holding `gateway:approve`, 0056), and every ship that calls it through its proxy ship.

After this, they can:
1. Add an OAuth-only server such as Attio: a human signs in to it once in a browser, as the outside account the fleet should act as, and consents.
2. Have every ship within reach call its tools as today, by a message to the proxy ship, with no session holding the outside credential.
3. Keep calling it for as long as the outside service allows, without a human signing in again while the grant holds.
4. Learn, as the right human, when the grant is lost, and sign in again; no call is lost meanwhile.
5. See which ship made which call, although the outside service sees one account.

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

## 3. Questions for Thomas

1. **Whose identity do the calls carry?**
   Context: Attio acts as the member who consented (L11). Products either share one grant owned by one human or hold a grant per user (L14). A per-person grant needs every person to sign in, and a ship's call to carry its owner's grant, which is new work in the gateway.
   Options: (a) one grant per party, from one dedicated outside account ("a dedicated Aeolus account in attio"); (b) a grant per person, a ship's call carrying its owner's; (c) (a) now, (b) later as its own design.
   Pick: (c). It is what Thomas named, fits one proxy ship per party (L22, L24), and keeps (b) open without building it before a customer needs it (L33).

2. **Tracking: who did what, when every ship acts as one Aeolus account in Attio?**
   Context: Attio records one `workspace-member` for every call (L12); no shared-grant product traces further (L15). Core already stores every call as a message from the asking ship to the proxy ship (L26), and the gateway keeps each call.
   Options: (a) the fleet's own record is the trace: the party's page lists its calls (time, ship, tool, outcome) from the gateway's call store, each linked to its message in core, kept for the fleet's retention (L31); (b) (a), and the gateway also stamps the asking ship's name into the outside call where the tool has a free field (a note or description), so Attio shows it too; (c) one outside account per ship or per owner.
   Pick: (a). It needs no outside cooperation and holds for every server; (b) changes the asker's arguments, which a message should not do silently, and (c) breaks on seat cost and on servers with no workspace of their own.

3. **Who signs in to the outside service, and where?**
   Context: the browser step needs a human (L17), and approving is ordinary work, not argo's (L23). A server added from a person's request is added by an approver today.
   Options: (a) the approver, on the gateway's add-server page, as part of adding it: the page sends them to the outside service and back; (b) a separate human named by the approver, sent a link; (c) argo only.
   Pick: (a). One step, by the actor who already answers for the party. The page shows which outside account consented where the server says (an `openid` subject, L10) and writes its issuer and subject as a verified fact (L30), so signing in as one's own account by mistake is visible.

4. **How does the gateway register as a client with the outside authorization server?**
   Context: the spec's order is pre-registered, CIMD, dynamic registration (L2); Attio offers only dynamic registration (L10). Client credentials are bound to their issuer (L3).
   Options: (a) the spec's order, with CIMD at one document the gateway serves and dynamic registration once per issuer per gateway installation; (b) the same, but dynamic registration once per party; (c) pre-registered only, the approver pasting a client id and secret.
   Pick: (b). A client per party keeps one fleet's grants apart from another's when a fleet's party is retired or a client is revoked at the outside service, and the client's consent screen names the party (L9). CIMD comes when the first server offers it.

5. **When the grant is lost, what happens to calls?**
   Context: a refresh answered `invalid_grant`, or a revoked or unused grant (L16, L20), needs a human. Today a refused credential is handed again and stops at the fifth attempt (L27), far sooner than a human signs in again.
   Options: (a) the gateway stops taking the party's calls until a human signs in again; calls wait in the fleet, the proxy ship reports blocked with why, and the waiting calls go on after; (b) each call is answered at once with an error result naming the lost grant; (c) today's rule, five attempts then stopped.
   Pick: (a). No call is lost or failed for a cause a human fixes in minutes, and the blocked report and the fleet's stuck deliveries make it visible (0042). A caller that cannot wait sees the report through discovery.

6. **When the grant is lost, who is told, and who may sign in again?**
   Context: the owner answers for the proxy ship (L22, L28). Re-consent must need a right to change the party (L18).
   Options: (a) the proxy ship's owner gets a message once, with the party's page; any actor holding `gateway:approve` within manage reach signs in again there; (b) the gateway's owner gets a question; (c) every holder of `gateway:approve`.
   Pick: (a). The owner answers for the party; approving is the right that set the grant, so it is the right that sets it again. Signing in again as another outside account is allowed and shows on the page (question 3).

7. **Does the gateway keep an unused grant alive?**
   Context: refresh tokens may end unused (L20) and may rotate (L19); Attio documents neither (L13).
   Options: (a) refresh ahead of the access token's expiry and also on a schedule while the party is idle, one refresh at a time per party, the new refresh token stored before it is used; (b) refresh only when a call needs it.
   Pick: (a). An unused party stays usable, and a refresh that fails is found before a call needs it, so question 6's human is told early.

8. **Which outside scopes does the gateway ask for?**
   Context: the spec's default is the 401's scope, else all `scopes_supported` (L6); Attio lists `mcp`, `offline_access`, `openid` (L10). The fleet limits a party by its tool switches (L29).
   Options: (a) the spec's default, adding `offline_access` and `openid` when listed; (b) the approver picks scopes on the page.
   Pick: (a). The tool switches already narrow what ships reach, and an approver rarely knows a server's scopes.
