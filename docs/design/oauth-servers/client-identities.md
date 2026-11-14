# Outside OAuth servers without automatic client registration

## Purpose agreed by Thomas

Let a fleet add an outside MCP server whose OAuth service does not register clients automatically, so each person signs in as their own outside account and their ships use that sign-in. Support an existing client id, with a secret where needed, and a gateway-controlled URL client id where the service accepts it. Preserve discovery, issuer checks, PKCE S256, grants per person, and tool and reach checks. Absence of automatic registration alone must no longer prevent addition. This does not promise compatibility with every OAuth service or a particular Home Assistant installation.

Authority: [gateway issue 348, first pass and Thomas's answers](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/348#issuecomment-6880173708). This design proposes the detailed flows below for approval. It contains no implementation slices.

## Lessons to check against

- [0067](../../decisions/0067-outside-oauth-sign-ins.md) requires dynamic client registration (DCR) and defers entered clients and client metadata documents (CIMD). Those are the clauses this design changes; whose grant a call uses is unchanged. Its client-per-party rationale is isolation between fleets, separate consent and client retirement.
- The gateway's [approved addition guide](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/blob/main/docs/guide/add-an-outside-mcp-server.md) keeps Address, Owner, Sign in, with Later allowed and tools shown after the first sign-in. Direct addition requires `fleet:manage`; tool switches require `gateway:approve`. Request approval does not offer Each person signs in. The older OAuth design's use of “approver” does not change these permissions.
- [0016](../../decisions/0016-no-policy.md), [0056](../../decisions/0056-outside-parties.md) and [0057](../../decisions/0057-actors.md) leave permission to core's scopes and reach. Outside credentials stay in the gateway, never ship messages, statements or verified facts. Normal addition does not go through argo.
- `createAddSignInServer` currently checks discovery and S256, then requires `registration_endpoint`; a repeat of a kept request reuses its client. Discovery, obtaining a client and commissioning a proxy ship are separate operations.
- `createAuthorizationServers` discovers protected-resource and authorization-server metadata and checks the issuer through the MCP SDK. It currently drops CIMD and token-authentication capability information. Missing DCR does not mean missing discovery.
- `SignInClient` allows a null secret and null registration-management fields; `clientAuthenticationOf` currently infers public versus form-secret authentication from the secret alone. Basic authentication needs an explicit method carried through code redemption, refresh and revocation.
- `createCompletePartySignIn` checks the sealed ten-minute state, browser account, response issuer and returned ID-token issuer/audience, then stores a per-person grant. Owner selection, refresh locking, first tool reading and sign-in-needed notices already exist.
- `createEndPartyGrants` currently deletes a client if both registration-management fields exist. A supplied client is outside the gateway's ownership; a URL client has no DCR registration to delete. Ownership must remain explicit throughout retirement.
- `src/adapters/oauth/client-metadata-documents.ts` reads inbound clients' documents. An outbound gateway document is a new publisher, not that reader with its direction reversed.
- [Home Assistant authentication](https://contributors.home-assistant.io/core/internals/auth-api/) distinguishes website URL client ids from metadata documents and applies redirect-address constraints. Its authentication documentation does not establish that a target MCP installation passes the gateway's protected-resource discovery checks.
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) supports several client identity mechanisms. The explicit default here follows Thomas's answer; it is not an automatic retry ladder inferred from the spec. [0013](../../decisions/0013-breaking-changes-before-1-0.md) calls for a minimal design without a compatibility framework.

## Decisions answered by Thomas

- D1: Remove only the client-registration blocker; retain discovery and all existing sign-in, grant, tool and reach checks.
- D2: Keep automatic registration as the default and offer explicit fixed-client and URL-client choices; a refusal never silently switches identity.
- D3: Generate one gateway-controlled URL client id per server added; ask for a fixed client dedicated to that server, without adding an unapproved uniqueness prohibition.
- D4: Support plain URL client ids and gateway metadata documents when the authorization server advertises CIMD support.
- D5: Support public clients (`none`), form secrets (`client_secret_post`) and Basic headers (`client_secret_basic`).

## Draft superseding decision text for Thomas's approval

Proposed replacement for 0067's **Registration** paragraph:

> **Client identity.** Every party has one OAuth client bound to its discovered issuer; every person's grant of the party uses that client. Automatic dynamic registration (RFC 7591) remains the default. The person adding the server may instead enter an existing client id, with a secret and its authentication method where required, or choose a gateway-controlled URL client id unique to that addition. Ask for an entered client dedicated to that server. URL ids support the service's plain URL convention or a gateway-owned client metadata document when the service advertises support. A failed or refused selected method never silently selects another. Public, client_secret_post and client_secret_basic clients are supported. Discovery from the protected resource, issuer binding, PKCE S256 or refusal, resource in authorization and token requests, state and issuer checks, and the existing outside-scope selection remain required.

Proposed replacement for the client clause in **Ending a grant**:

> Retiring the party ends all its grants, revoking their tokens where offered and dropping them locally regardless of revocation success. Delete an outside client only when the gateway dynamically registered it for this party and holds its registration-management credentials. Never delete an entered client. A gateway URL document is withdrawn when its party is retired; there is no outside registration to delete.

Proposed replacement for the relevant **Rejected** clause:

> Rejected: requiring pre-registered clients as the only method; silently falling back after registration refusal; one gateway URL client id shared across parties. Entered clients and client metadata documents are supported as explicit choices.

The rest of 0067, including per-person ownership, consent, grants and call handling, remains in force. On approval, update 0067 and its index line together, replacing the entered-client/CIMD deferral and DCR-only refusal. This file is the draft; it does not mark that decision approved or allocate a new decision number.

## Flow vocabulary and code ownership

All code paths below are in `ThomasHendrickx/aeolus-fleet-gateway`. Names are existing code unless explicitly marked proposed. Diagrams describe the intended behavior, including unchanged steps, rather than claiming it already exists.

| Diagram name | Code touched by that step |
| --- | --- |
| Add page | `web/features/add-server/actions.ts` (`checkServer`, `approveServer`), `web/features/forms/server-credential.ts`, `web/features/add-server/ui/`, `web/features/add-server/ui/sign-in-step.tsx` |
| API | `src/adapters/trpc/router.ts`: `serverCredentialInputSchema`, `parties.approve`, existing actor and scope checks |
| Add | `src/core/parties/add-sign-in-server.ts`: `createAddSignInServer`, `scopeOf`; `src/core/parties/ports.ts`: `AuthorizationServers`, `DiscoveredSignIn` |
| Discover / register | `src/adapters/oauth/authorization-servers.ts`: `createAuthorizationServers`, `discover`, `register` |
| Client / store | `src/core/vault/credential.ts`: `SignInClient`; `src/adapters/prisma/party-store.ts`, `src/adapters/prisma/schema.prisma`: party credential persistence |
| Approve / fleet | `src/core/parties/approve-party.ts`: `createApproveParty`, `approved`; `ProxyShipDoor` in `src/core/parties/ports.ts`; `src/app.ts` wiring |
| URL document | Proposed outbound HTTP publisher wired in `src/app.ts` beside `src/adapters/http/party-sign-in-routes.ts`; proposed persisted URL identity lookup in `PartyStore` and `party-store.ts`; no existing outbound publisher |
| Start / callback | `src/core/party-grants/start-party-sign-in.ts`: `createStartPartySignIn`; `src/core/party-grants/complete-party-sign-in.ts`: `createCompletePartySignIn`; `src/adapters/http/party-sign-in-routes.ts`: `registerPartySignInRoutes` |
| OAuth requests | `src/adapters/oauth/party-sign-ins.ts`: `createPartySignIns`, `clientAuthenticationOf`, `posted`, `redeemCode`, `refresh`, `revoke`, `deleteClient` |
| Grants / tools | `src/adapters/prisma/party-grants.ts`; `src/core/party-grants/ports.ts`; `src/core/mcp-out/state-party.ts`; `src/core/party-grants/listing-connection.ts`; `src/core/parties/read-party-tools.ts` |
| Calls / refresh | `src/core/party-grants/call-grant.ts`, `refresh-grant.ts`, `keep-grants-alive.ts`, `tell-sign-in-needed.ts`; `src/core/mcp-out/run-party.ts`, `hand-call.ts`, `grant-calls.ts` (`createGrantCalls`) |
| Retire | `src/core/parties/retire-party.ts`, `src/core/party-grants/end-party-grants.ts`, `end-grant.ts`; party and grant stores above |

### Client information carried between the steps

Proposed: keep the selected source (automatic, fixed or URL), token authentication method and gateway ownership with the issuer-bound `SignInClient`. Only automatic registration can supply registration-management credentials. Never accept those management credentials through the fixed-client form. URL clients are public. Fixed clients explicitly select public, form secret or Basic; secrets are required for the latter two and absent for public clients. Reject unsupported methods rather than guessing from a supplied secret. Check discovered capabilities, applying the OAuth metadata defaults when omitted; registration responses must agree with the supported selected authentication method.

Use `client_id` without a secret for public token requests; put the secret in the form only for `client_secret_post`; for `client_secret_basic`, encode the client id and secret as OAuth requires and send them in `Authorization: Basic`, with no secret in the form. Code redemption and refresh use the same stored method. Revocation uses the endpoint's advertised methods where given, otherwise its OAuth defaults; do not change identity to work around refusal. The authorize URL always uses the client id and never its secret. Preserve `resource`, PKCE and scope calculation. Client secrets and registration tokens do not enter logs or ordinary party output.

Each generated URL uses an opaque, stable identity for the addition, not just the party name or issuer. A repeat of that addition reuses it; retiring and adding the same name again gets a new URL. Proposed path: `https://<gateway>/outside-oauth/clients/<opaque-id>`. Keep its fleet association in the gateway; do not expose fleet credentials. The URL is public identity information, not a bearer credential.

In document mode, serve JSON at that exact URL, without account sign-in, containing matching `client_id`, a client name, the exact gateway callback in `redirect_uris`, `grant_types` for authorization code and refresh, `response_types: ["code"]`, and `token_endpoint_auth_method: "none"`. No person, grant, token or management credential belongs in it. Plain mode uses the distinct URL as the client id without claiming CIMD support. An explicit plain choice supplies the service-specific intent; missing DCR alone is not evidence it accepts URL ids. A service whose redirect rules cannot accept the gateway callback remains incompatible.

The proposed publisher does one indexed lookup by opaque identity, scoped internally to its owning fleet/party, and returns only the public document of a live party. It does not scan all fleets or grants. At the fleet's design scale of 3,000 ships and 10 million messages, that read is independent of message count; apply the repository's p95 <100 ms and p99 <500 ms local-read budgets, excluding outside-service latency. No cache is needed initially, so retirement takes effect on the next gateway read; an authorization server's cached document may outlive that response but cannot restore local grants or the retired proxy ship.

## Full flows

### F1: common addition and checks, including refusal

```mermaid
flowchart TD
  A["Add page: Address, Each person signs in, explicit client choice"] --> B["Owner: choose owner, API parties.approve"]
  B --> C{"API: actor has fleet:manage, fleet serves outside parties?"}
  C -->|No| R["Inline refusal, no new party, grant or client"]
  C -->|Yes| D{"Add: same kept request?"}
  D -->|Yes| E["Reuse stored client, resume Approve, never register again"]
  D -->|Conflicting name or request| R
  D -->|New| F["Discover: challenge, resource metadata, AS metadata, issuer"]
  F --> G{"Reachable, metadata valid, issuer matches, S256 advertised?"}
  G -->|No| R
  G -->|Yes| H["Add: scopeOf, validate selected identity and auth method"]
  H --> I{"Selected method valid and supported?"}
  I -->|No| R
  I -->|Yes| J["F2 automatic, F3 fixed, or F4 URL, no silent fallback"]
  J --> K["F5 persist and commission, then F6 sign in or Later"]
  E --> K
```

The sign-in credential still bypasses pre-sign-in tool reading in `checkServer`. Discovery checks occur in `createAddSignInServer` on addition. A discovery timeout, absent protected-resource/AS metadata, issuer mismatch, missing S256, unsupported authentication or absent CIMD advertisement for document mode returns a specific reason at the addition step. It keeps no new local party or grant and sends no secret to an unvalidated issuer. Fixed-client acceptance and the person's consent cannot be proven by discovery: token or redirect refusal appears during F6. Success adding a server therefore does not falsely claim a working sign-in.

### F2: automatic registration

```mermaid
sequenceDiagram
  participant A as Add
  participant O as Discover / register
  participant S as Outside authorization server
  participant P as Approve / store
  A->>A: Common F1 checks passed, automatic selected
  alt No registration_endpoint
    A-->>A: Refuse NO_DYNAMIC_REGISTRATION, choose another method explicitly
  else Registration advertised
    A->>O: register(name, callback, scope)
    O->>S: RFC 7591 registration, supported auth method
    alt Refused, timeout, or malformed response
      S-->>O: Failure or no usable client response
      O-->>A: REGISTRATION_REFUSED, no local party or grant
      Note over A,S: Never switch to fixed or URL automatically
    else Valid registration
      S-->>O: Client id, optional secret and management credentials
      O-->>A: Validated client and authentication method
      A->>P: F5 with issuer-bound gateway-owned client
    end
  end
```

The current registration request asks for `client_secret_post`; retain that request rather than inventing a preference ladder. Validate the returned method, including the applicable registration default when omitted, against supported public/form/Basic handling and discovered capabilities. Missing DCR remains an error for the automatic choice alone. If the outside service registers a client but its response is lost, the gateway has no id or management token to delete it; this is an existing remote-registration uncertainty, not permission to repeat under a different identity. See open question 1 for the post-registration commission-refusal gap.

### F3: fixed client id

```mermaid
sequenceDiagram
  participant U as Person adding server
  participant W as Add page / API
  participant A as Add
  participant P as Approve / store
  U->>W: Choose fixed, enter dedicated client id and auth method
  W-->>U: Show exact callback to register with the service
  opt Form secret or Basic selected
    U->>W: Supply secret
  end
  W->>A: Addition input, common F1 discovery and checks
  alt Missing id, inconsistent secret or unsupported method
    A-->>W: Specific refusal, no new party or grant
    W-->>U: Correct the entered client or its configuration
  else Valid input and checks
    A->>A: Bind id and method to discovered issuer, owned=false
    Note over A,P: No DCR call, no management credentials accepted
    A->>P: F5 with supplied client
    P-->>U: Added, Sign in or Later
    Note over U,P: F6 proves service accepts id, callback and authentication
  end
```

A fixed client can itself have a URL-shaped id; this remains the fixed choice when the person supplies it. Do not confuse OAuth client authentication with the existing `clientCredentials` server credential: every person still completes authorization code sign-in.

### F4: gateway URL client id, plain and metadata document

```mermaid
sequenceDiagram
  participant U as Person adding server
  participant A as Add / Discover
  participant P as Client / store
  participant H as URL document
  participant S as Outside authorization server
  U->>A: Choose gateway URL, plain or document mode
  A->>A: Common F1 discovery, issuer and S256 checks
  alt Document mode without client_id_metadata_document_supported=true
    A-->>U: Refuse unsupported document mode, keep nothing
  else Selected URL mode passes checks
    A->>P: Allocate distinct stable URL for this addition, public client
    A->>P: F5 persist client and commission proxy ship
    P-->>U: Added, Sign in or Later
    U->>S: F6 authorize with generated URL client_id and exact callback
    alt Plain URL mode
      S->>S: Apply its URL client and redirect convention
      alt URL or redirect refused
        S-->>U: Sign-in refusal, no grant
      else Accepted
        S-->>U: Authorization code, continue F6 callback
      end
    else Advertised document mode
      S->>H: GET exact URL client_id
      alt Live document, matching id and permitted callback
        H-->>S: Public JSON metadata, no secrets
        S-->>U: Consent and code, continue F6 callback
      else Unreachable, retired, or metadata rejected
        H-->>S: Failure or no live document
        S-->>U: Sign-in cannot finish, no grant, retry after correction
      end
    end
  end
```

The document must be available before redirecting the first person to consent. Publish only the kept live party, and keep the callback identical to `PARTY_SIGN_IN_DONE_PATH` under the configured public gateway address. Retrying an addition after F5 has kept it reuses its URL; it does not publish another identity. A refused URL sign-in does not fall back to DCR or a fixed id.

### F5: keep the party, commission and crew the proxy ship

```mermaid
flowchart TD
  A["Add: selected issuer-bound client ready"] --> B["Approve: check connection and request, save commissioning party and client"]
  B --> C["ProxyShipDoor: commission app ship with owner and request id"]
  C --> D{"Fleet answer"}
  D -->|Unavailable or answer lost| E["Keep saved party, return refusal, same request resumes"]
  D -->|Definite refusal| F["Current approved(): remove party, return COMMISSION_REFUSED"]
  F --> G["No grant, fixed client untouched, URL unpublished, DCR cleanup gap Q1"]
  D -->|Ship and secret| H["Save awaitingCrew before register"]
  D -->|Ship but no recoverable secret| I["Keep awaitingCrew, show state, do not commission another ship"]
  H --> J{"Register proxy ship succeeds?"}
  J -->|No| E
  J -->|Yes| K["Save crew token, write verified issuer fact, no secret in facts"]
  K --> L["Added: Sign in or Later, no tools until first usable grant"]
  L -->|Sign in| M["F6"]
  L -->|Later| N["Party page, no person's grant invented"]
```

`approved` persists before each fleet step and reuses the same request. A verified-fact refusal does not undo addition; a repeat retries facts. The diagrams preserve these existing outcomes. No part of a failed check authorizes deletion of a supplied client. Outside client registration and fleet commission are not one transaction.

### F6: first sign-in and first tool reading, all client choices

```mermaid
sequenceDiagram
  participant U as Person / browser
  participant G as Start / callback
  participant O as OAuth requests
  participant S as Outside authorization server
  participant P as Grants / tools
  U->>G: Sign in from added server or party page
  G->>G: signInPartyOf checks approved server, account and person ship
  alt No account/person or no sign-in party
    G-->>U: Refuse, do not start outside sign-in
  else Allowed
    G->>G: Seal fleet, party, account, person, verifier, ten-minute expiry
    G->>O: authorizeUrl with S256, state, resource, scope, callback
    O-->>U: Redirect using stored client_id, never a client secret
    U->>S: Sign in as own outside account, consent
    Note over U,S: URL document lookup or plain URL validation is F4
    S-->>G: Callback with state and code, or error, iss where stated
    G->>G: Check state/expiry, browser account, live party and response issuer
    alt Bad state/account/issuer, cancelled consent, or absent code
      G-->>U: Failure outcome, redeem nothing, keep no new grant
    else Callback valid
      G->>O: redeemCode with verifier, callback and stored client
      O->>S: Token POST with resource and public/form/Basic authentication
      alt Unreachable, refused, or malformed token response
        S-->>O: Failure
        O-->>G: Typed refusal
        G-->>U: Failed or unavailable, keep no new grant
      else Tokens returned
        S-->>O: Access token, optional refresh token and ID token
        O-->>G: Tokens and parsed claims
        G->>G: Check ID-token issuer/audience if present, subject not another person's
        alt Claim mismatch or subject taken, including concurrent insert
          G-->>U: Failed or turned away, discard new tokens, earlier grant unchanged
        else Valid person grant
          G->>P: Keep grant replacing this person's earlier grant
          G->>P: Close notice and finish own sign-in step if present
          G->>P: stateParty lists tools with usable grant and states proxy ship
          alt Tools or statement temporarily fail
            P-->>G: statementRefusal
            G-->>U: Signed in, grant kept, tools await later successful statement
          else Tools and statement succeed
            P-->>G: Tools and statement ready
            G-->>U: Signed in, tools shown with existing switches and reach
          end
        end
      end
    end
  end
```

`registerPartySignInRoutes` maps typed outcomes to the party page and logs statement failure without tokens. Later statements can use another usable grant, most recently used first. A new client mechanism does not allow one person to sign in for another, nor argo to supply a grant for its ships.

### F7: refresh and calls

```mermaid
flowchart TD
  A["keep-grants-alive: ahead of expiry or idle schedule"] --> R["refresh-grant: PartyGrants.change holds one grant"]
  C["run-party: call handed over, core reach and tool checks"] --> O["call-grant: read asking ship owner now"]
  O -->|Owner unread| W["Wait and retry owner read, no outside call"]
  O -->|Argo or no person| N["Immediate error result, no outside call"]
  O -->|No usable person grant| M["Immediate missing-sign-in result and page, tell person once"]
  O -->|Usable grant| T["Call with person's access token"]
  T -->|401| R
  T -->|403 insufficient_scope| S["Error result with sign-in page, keep grant"]
  T -->|Success| OK["Existing durable reply and handling flow"]
  R --> H{"Held grant state"}
  H -->|Removed or lost| M
  H -->|Already refreshed by another caller| U["Use newly held grant, no second refresh"]
  H -->|No refresh token| E["Refresh unavailable, require sign-in when no usable access remains"]
  H -->|Can refresh| P["OAuth requests: same client, issuer, resource, stored auth method"]
  P --> Q{"Token endpoint answer"}
  Q -->|Success| K["Store access and rotated refresh token before use, retain old refresh if none returned"]
  Q -->|invalid_grant| L["Mark lost, unlock, tell person once with sign-in page"]
  Q -->|Other refusal or unreachable| F["Keep grant unchanged, return failure, scheduler or call follows existing retry rules"]
  K --> U
  U --> Z{"Refresh triggered by a 401?"}
  Z -->|Yes| V["Retry outside call once, another 401 is an error, no refresh loop"]
  Z -->|No| D["Scheduled refresh done"]
  V -->|Success| OK
  V -->|Insufficient scope| S
  V -->|Still unauthorized| M
```

`createGrantCalls` in `src/core/mcp-out/grant-calls.ts` also refreshes a near-expiry grant before hand-over. If that refresh fails while the held access token remains usable, the call can still use it; `invalid_grant` or a removed grant cannot. An unreachable refresh after expiry stays on the existing not-sent retry path. The refresh lock and persistence are `createRefreshGrant` and the Prisma `PartyGrants.change` implementation. Never send a fixed client secret to an issuer newly inferred from a failed call. The stored client remains bound to the checked issuer. No calls wait for a person to sign in; the existing durable result and notice behavior remains. Client authentication changes apply equally to scheduled refresh and 401-triggered refresh.

### F8: retire without deleting a client the gateway does not own

```mermaid
sequenceDiagram
  participant U as Actor
  participant R as Retire
  participant F as Fleet
  participant G as Grants / OAuth requests
  participant P as Client / store / URL document
  U->>R: Retire party
  R->>R: Check fleet:manage and fleet-scoped party
  alt Actor lacks scope or party absent
    R-->>U: Refuse, retain grants and client
  else Party exists
    opt Proxy ship known
      R->>F: Retire as actor, core checks manage reach
      F-->>R: Retired, already retired, refused, or unavailable
    end
    alt Fleet refuses or is unavailable
      R-->>U: Refuse, keep local party and grants
    else Retired, already retired, or no proxy ship known
      loop Grants of this party only, cursor batches of 100
        R->>G: endGrant with stored client and authentication method
        opt Revocation endpoint offered
          G->>G: Revoke refresh token then access token
          Note over G: Refusal or timeout does not retain local grant
        end
        G->>P: Remove local person's grant
      end
      alt Gateway DCR ownership and both management credentials
        R->>G: deleteClient at registrationClientUri with registration token
        Note over G: Current failure handling still completes local retirement
      else Fixed client or URL client or no management credentials
        R->>R: No outside client DELETE
      end
      R->>P: Remove party/client, revoke gateway-issued party tokens
      P->>P: URL lookup now returns no live document
      R-->>U: Retired, new addition uses a new identity
    end
  end
```

Only the retired party's grants are traversed, scoped by fleet and party; unrelated grants are untouched. Failure to revoke tokens or delete an owned DCR client cannot be reported as successful remote cleanup, even though current code completes local retirement. Revocation removes grants, not the supplied client. A retired document cannot start a new local sign-in: both start and callback require the live party. Outside caches do not give a retired proxy ship permission to act.

## Open questions

1. After DCR succeeds but fleet commission is definitely refused, should the gateway best-effort delete the client it just registered, or retain a recoverable addition until cleanup succeeds? `approved()` currently removes the party on definite commission refusal and has no client-cleanup hook; Thomas's answers choose client identities but do not settle this failure boundary. Proposed answer: best-effort deletion only for this addition's gateway-owned DCR client, with an explicit cleanup failure report; never touch a supplied client. A lost registration response remains unrecoverable without a client id or management credentials. This question does not change pre-registration check failures or the explicit no-fallback decision.
