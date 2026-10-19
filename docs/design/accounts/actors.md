# Who a call acts for: ships, accounts and the installation

Design by designer-accounts, for Thomas. Thomas decided on 19 Oct that phase 2 is redesigned with pagasae not a ship, so pagasae needs a link of its own to core. The questions of phase 2's round 3 (P1 to P9, [`phase-2/README.md`](phase-2/README.md)) are on hold. This is phase 1 of that redesign: the purpose, the lessons to check against, the link between pagasae and core, and the questions, each with its context, a use case, options with what goes wrong, and a pick. No detailed decisions before Thomas agrees the purpose. No code.

Every word is a term of the blueprint's Domain language (PR #972), except "actor", which question 1 puts to Thomas. Here it means whoever a call is authorised for and an event names: a ship, an account, or the installation.

## 1. Purpose

### 1.1 Today

"Every caller is a ship" (0012). A call reaches core in one of three ways (architecture, Procedure groups):

| Way in | Who | Rights from |
| --- | --- | --- |
| A crew token | The ship whose lease it is | That ship's scopes and reach |
| A console sign-in | argo, or the viewer | argo's or the viewer's scopes and reach |
| The installation token | The hosting service (pagasae) | Fleet create, list, get, delete, sign-in tickets: no scopes, no fleet (0020) |

Every event names an actor ship, or the system (architecture, `events`). The installation token is already a caller that is not a ship.

### 1.2 What "every caller is a ship" costs

Phase 2 followed the rule, and these are what it took:

- **P1.** pagasae became a plugin ship in every fleet, holding every scope a group may give, only so it could change person ships.
- **P6.** `fleet:on-behalf` had to widen from reading to managing, only so pagasae could act for a person ship it does not own.
- **argo holds everything** partly because only a ship can act: anything no other ship may do falls to argo.
- **A human needs a person ship to do anything**, even one who never sends or receives a message: Mathilde administering the fleet, Thomas commissioning an agent. Each needs a ship, a lease the gateway holds, and pagasae rescoping it (0052).
- **Two callers are already not ships**: the organisation admin's rights sit on the account (question 2 of `accounts.md`), and the installation token (0020).

### 1.3 What a ship is for, and what authorising is for

A ship is what messaging needs: an address, an inbox, a lease and the delivery guarantee, an owner who gets its questions and trouble (0045), a statement others discover (0047). Authorising and auditing a call need less: a named actor with scopes and a reach, and an event that names it. Today's rule joins the two; the cost above comes from joining them.

The direction proposed to Thomas, not decided beyond pagasae:

- Keep: everything that sends or receives messages is a ship.
- Change "every caller is a ship" to: every call is authorised for an actor by scopes and reach, and every event names that actor.
- Actors: a ship (its crew token or console sign-in), an account (vouched for by pagasae; core checks a signed claim with its scopes and never stores accounts), the installation.

### 1.4 The jobs

| # | Job |
| --- | --- |
| A1 | Authorise every call for a named actor, by scopes and reach, the same way whatever the actor is |
| A2 | Every event names the actor who did it, so a fleet's history says which human acted (G9) |
| A3 | pagasae changes what it must in a fleet without being a ship (Thomas, 19 Oct) |
| A4 | Core never stores accounts: the organisation stays pagasae's tenant, the fleet core's (0050) |
| A5 | A human with rights in a fleet needs a ship there only when they send or receive messages |
| A6 | Messaging stays as it is: whatever sends or receives is a ship, with its inbox, lease and guarantee |
| A7 | A fleet stays recoverable when pagasae or a permission is wrong (argo's reason, 0053) |
| A8 | A leaver's access ends at once, including what pagasae vouched for before (question 12) |

### 1.5 A good outcome

At Acme:

- Mathilde retires an agent from the networking plugin's page. She signs in through pagasae; the page calls core with her claim; the event names her account. She has no person ship in that fleet, because she never messages there.
- Charlotte talks to the CRM's app ship from her Claude: she sends messages, so she has a person ship, and the gateway crews it.
- Mathilde moves Charlotte from sales to finance. Charlotte's next claim carries finance's scopes; nothing is rescoped by a ship holding everything.
- Burak leaves. His claims stop being accepted within a minute, his person ship and his trierarch are released, every ship stays.
- pagasae is down for an hour. Fleets go on messaging; whoever signs in as argo by argo's own sign-in (self-hosted) still acts; claims already given keep working until they end.

### 1.6 Not this design's

- Messaging itself: inboxes, leases, delivery (0040).
- The organisation's model in pagasae (0051, 0052 as far as they hold).
- Network rules themselves (0034 to 0037), except which actor a rule's selector can match.

## 2. Lessons to check against

### 2.1 From Aeolus

| Lesson | Source |
| --- | --- |
| **Scope says what, reach says where**, for every type of interaction. A selector picks ships by labels or owner, never by type | 0034, 0046 |
| **Reach is defined over ships.** A rule's two selectors match ships' labels and owners; an actor that is not a ship has no labels in core today, so a rule cannot select it | 0034, 0031 |
| **No rights travel with a message.** Core and the plugins police scopes | 0046 |
| **A ship grants only what it holds**; nothing widens itself | 0046 |
| **The installation is already a caller that is not a ship**, with no scopes, outside every fleet | 0020 |
| **Every event names an actor ship or the system**; events are the audit trail and the live updates | architecture `events` |
| **The fleet is core's tenant, the organisation pagasae's**; core keeps no account | 0007, 0050 |
| **Owners are ships**, because questions and trouble go to the owner's inbox | 0045, 0038 |
| **argo must always be able to act**; a permission bug never leaves a fleet unrecoverable without the database | 0053 (Thomas) |
| **Plugin pages already trust a credential core vouches for** (`console.session`) and check its scopes | 0012, 0043 |
| **Thin designs for few people** | 0013 |

### 2.2 From the field

For lessons, not to copy.

| Lesson | What they do | Source |
| --- | --- | --- |
| **What receives is not what acts.** An endpoint need not sign in | Exchange: a shared mailbox has no username or password and its account stays disabled; people sign in as themselves and act on it (Full Access, Send As, Send on Behalf). Slack: a bot token belongs to the app, not a person, and outlives the person who installed it | [shared mailboxes](https://learn.microsoft.com/en-us/exchange/collaboration/shared-mailboxes/shared-mailboxes), [Slack tokens](https://docs.slack.dev/authentication/tokens) |
| **One permission model for every kind of actor** | Entra: users and applications both act through a security principal, and roles are granted to any kind the same way. Kubernetes: one RBAC whose subjects are users, groups or service accounts | [Entra principals](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals), [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) |
| **The resource server need not store the humans** | Kubernetes has no object for a normal user: the API server checks an OIDC token's signature and expiry against the issuer's keys, without calling the issuer, and reads the user and groups from its claims. Service accounts, which are machines, are its own objects | [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/) |
| **Acting for someone is explicit and narrows** | GitHub: an app acts as itself (installation token) or for a user (user token), and then reaches only what both the user and the app may. Kubernetes impersonation needs its own grant | [GitHub on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user), [impersonation](https://kubernetes.io/docs/reference/access-authn-authz/user-impersonation/) |
| **The audit names who acted apart from what was acted on, and both parties when one acts for another** | Entra: `initiatedBy` (a user or an app) and `targetResources`. GitHub: `actor` and `user`. Kubernetes: `user` and `impersonatedUser` | [Entra audit](https://learn.microsoft.com/en-us/graph/api/resources/directoryaudit), [GitHub audit fields](https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/audit-log-events-for-your-enterprise) |
| **A removed human keeps access until the token ends; keep tokens short** | Kubernetes: an id token "can't be revoked, it's like a certificate so it should be short-lived (only a few minutes)". Introspection (RFC 7662) revokes at once at the price of asking the issuer on every call | [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) |
| **Check issuer, audience, type and signature exactly; rotate by key id** | RFC 9068: `iss` matches exactly, `aud` holds the server's own identifier, `typ` is `at+jwt`, keys from the issuer's key set. A new key is published before it signs; an unknown key id makes the verifier fetch the set again. RFC 8707 binds a token to one resource | [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068), [OIDC key rotation](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) |
| **An issuer outage stops new sign-ins, not what runs** | Cached keys go on checking tokens not yet ended; access fades as they end. Servers that ask the issuer on every call fail at once (an inference from the above, not stated in one source) | as above |

## 3. The link between pagasae and core

What this part settles is how pagasae vouches for an account, so core can authorise the account's calls without storing accounts. The choices in it are questions 3 to 5; this shows the shape they choose within.

### 3.1 The shape

- **Trust is set up once per installation.** Core is configured with pagasae's issuer and fetches its public keys from it, as it is configured with the installation token today. With none configured, core accepts no account: a self-hosted fleet with argo's own sign-in only (Q19 (e)). Adding pagasae later is setting it.
- **pagasae signs a claim for one account in one fleet**: the account (an opaque id and its email, for events), its organisation, the fleet it is for (the audience, so it is refused in any other fleet), the scopes and labels its groups give there, and a short life. Whoever acts for the human presents it: the console, a plugin's page, the gateway, a human's MCP client.
- **Core checks it on every call**: the signature against pagasae's keys, the audience against this fleet, the life against now. It then authorises the call by the claim's scopes and reach, as for a ship, and names the account as the actor of every event the call writes. It stores nothing else about the account. When a plugin's page or the gateway presents the claim, the event names the account and, in its details, the ship it came through: who acted, and through what.
- **pagasae acting as itself** (sign-up's fleet, a leaver's releases) uses the installation token, as the installation actor (question 4).

### 3.2 Hosted and self-hosted

| | Hosted | Self-hosted, without pagasae | Self-hosted, with pagasae |
| --- | --- | --- | --- |
| Accounts in a fleet | Yes, through pagasae's claims | None: argo's own sign-in only | Yes, once core is configured with pagasae's issuer |
| Installation token | pagasae holds it | Unset (0020) | pagasae holds it |
| argo | Signed in by allowed accounts | argo's own sign-in | Both (0054) |

### 3.3 Unhappy paths

| What goes wrong | What happens |
| --- | --- |
| pagasae is down | No new claims: nobody signs in through pagasae. Claims already given keep working until they end; messaging goes on; argo's own sign-in still works where it exists. Hosted fleets have no other way in for humans until pagasae is back |
| pagasae rotates its key | It publishes the new key beside the old before signing with it; core fetches keys again when a claim names a key it does not know, at most once a minute, so a forged key id cannot make core fetch without end |
| A claim for a leaver is still alive | Accepted until it ends, unless pagasae tells core first (question 3). The life of a claim is the longest a leaver keeps access |
| A claim is stolen | Usable in its one fleet until it ends; that is why the life is short |
| pagasae's signing key leaks | Anyone can vouch for any account in every fleet that trusts it, as the installation token can create and delete fleets today. Rotating the key ends every claim at once |
| Core's clock and pagasae's differ | A small allowance on the life, so a claim is not refused for seconds |
| An account's groups change | The next claim carries the new scopes; a claim already given keeps the old until it ends (question 3) |

## 4. Questions for Thomas

**1. The principle, and the word for who a call acts for**

What it is: 0012's "every caller is a ship" becomes two rules: everything that sends or receives messages is a ship; every call is authorised for an actor by scopes and reach, and every event names that actor. "Actor" is used in the principle "one organisation, many actors" but is not a term of the Domain language.

Use case: Mathilde retires an agent from the networking plugin's page without a person ship; the event names her account.

- (a) **The two rules, and "actor" as the term**: a ship, an account or the installation. Goes wrong: a second kind of caller beside ships, which every check and every event must handle.
- (b) **The two rules, and another word** ("principal", as Entra and Kubernetes say). Goes wrong: a word new to the fleet, where "actor" is already in its principles.
- (c) **Keep "every caller is a ship"**, and pagasae a non-ship exception like the installation. Goes wrong: P1 and P6 stay, and every human who administers needs a person ship.

Pick: (a).

**2. Does a human acting in a fleet act as their account?** (reopens questions 1, 3 and 11)

What it is: phase 2 gives every human with rights in a fleet a person ship, and every call they make is that ship's. With accounts as actors, a person ship is needed only for messaging.

Use case: Mathilde administers Acme's fleet and never messages in it. Charlotte sends to the CRM and gets questions from her PRD agent.

- (a) **A human acts as their account in every call that is not messaging**; they have a person ship only when they send or receive (Charlotte yes, Mathilde no), and their messages are that ship's. Goes wrong: one human appears as two actors (their account, their person ship), so a history of "what did Charlotte do" reads both.
- (b) **A human always acts as their person ship** (phase 2). Goes wrong: Mathilde needs a ship she never messages from, pagasae must rescope it, and the gateway holds its lease.
- (c) **A human acts as their account for everything, messages included**, and a person ship is only their inbox. Goes wrong: a message whose sender is not a ship, which breaks answers, owners and reach for messages (A6).

Pick: (a). Question 1 of `accounts.md` then reads: at most one person ship per account per fleet, and only when the human messages there. Question 3 (b) holds as "as their account, with their groups' scopes". Question 11 becomes: a person ship is commissioned when a human first messages in a fleet, on a group's allowance.

**3. What core accepts from pagasae, and how a leaver is cut off**

What it is: the claim of part 3: what it carries and how long it lives.

Use case: Burak leaves at 10:00. Mathilde disables him. His Claude holds a claim given at 9:58.

- (a) **A short claim with scopes and labels, and a pushed cut-off**: lives 10 minutes; pagasae tells core "account disabled", and core refuses that account's claims until the longest of them has ended. Goes wrong: if the push is lost, Burak keeps access up to 10 minutes; core keeps a short list of cut-off accounts.
- (b) **Core asks pagasae about every claim** (introspection). Goes wrong: every call waits on pagasae, and when pagasae is down nobody but argo's own sign-in can act in any fleet.
- (c) **A long claim (a day), cut off only by the push.** Goes wrong: a lost push leaves a leaver in for a day; a group change takes a day.

Pick: (a).

**4. What pagasae calls as itself, now that it is no ship** (replaces P1)

What it is: some changes have no human asking at that moment: sign-up's first fleet, a leaver's releases, a directory removing someone (later).

Use case: Burak is disabled; his person ship and his laptop's trierarch must be released in every fleet.

- (a) **pagasae acts as the installation**, with the installation token, through a few new installation procedures for one fleet: release what a disabled account crews, and commission or release a person ship. Events name the installation as actor, and their details name the account and the organisation admin who asked. Goes wrong: the installation, which today knows only fleets, learns about person ships and releases.
- (b) **pagasae acts for the organisation admin who asked**, with that admin's claim. Goes wrong: an admin must hold every scope these need, and a directory change has no admin.
- (c) **pagasae is a plugin ship** (phase 2's P1). Rejected by Thomas.

Pick: (a).

**5. How a rule reaches an account** (replaces P2 and P4)

What it is: network rules select ships by labels or owner (0034). An account is no ship and has no labels in core.

Use case: a manage rule lets `group=engineering` manage `group=engineering`. Thomas, as his account, retires an engineering agent, and must not retire a finance one.

- (a) **The claim carries the account's labels**, the values of pagasae's label `group` for its groups; a rule's selector matches an account by them as it matches a ship. A commission gives only label values the actor carries or defined (P4 as it was). Goes wrong: a rule's selector now matches two kinds of actor, and argo reading the rules must know an account can match.
- (b) **An account acts with its person ship's reach.** Goes wrong: every human with rights needs a person ship again.
- (c) **An account has scopes only, and reaches every ship.** Goes wrong: Thomas could retire finance's agent; reach stops saying where for humans.

Pick: (a).

**6. What argo still is**

What it is: argo holds every scope so a fleet can always act (0053); with accounts as actors, someone could hold every scope without argo.

Use case: pagasae is misconfigured and every claim lacks scopes. Acme's fleet must still be put right.

- (a) **argo stays the fleet's own actor and inbox**: a permanent ship with every scope, its built-in reach, its inbox for what argo owns, signed in by allowed accounts or argo's own sign-in. Events name argo and the account that signed in. Goes wrong: two ways to hold every scope (argo, and an account whose groups give all), so argo's reason must be kept by policy, not by structure.
- (b) **argo becomes an account with every scope.** Goes wrong: recovery then depends on pagasae; a self-hosted fleet without pagasae has no argo.
- (c) **argo is an inbox only**, and its rights go to accounts. Goes wrong: the same as (b), and argo-owned ships' questions go to an inbox nobody acts from.

Pick: (a).

**7. Who may own a ship** (0045)

What it is: an owner gets the ship's questions and trouble in its inbox (0038), so owners are ships today.

Use case: Thomas commissions an agent as his account. Who owns it, and where do its questions go?

- (a) **Owners stay ships**: a ship an account commissions is owned by the account's person ship, which is commissioned then if it has none, or by argo. Goes wrong: Thomas gets a person ship the moment he owns something, even if he never messages himself.
- (b) **An account may own**: its questions go to its person ship if it has one, else to argo. Goes wrong: questions for Thomas's agent land at argo; owner becomes two kinds.

Pick: (a). Owning means receiving, which is a ship's.

**8. What the decisions become**

What it is: the decisions that say "every caller is a ship", or follow from it.

| Decision | Today | Becomes under picks 1 to 7 |
| --- | --- | --- |
| 0012 | Every caller is a ship; argo crewed by the console | Every call is for an actor; argo as question 6 (a) |
| 0020 | The installation: fleets only | Also the actor pagasae acts as, for a few per-fleet procedures (question 4) |
| 0044 | Only argo commissions person ships; kinds | A person ship exists for messaging only (question 2); commissioning one is a scope an account may hold |
| 0045 | Owners are person ships or argo | Unchanged; an account owns through its person ship (question 7) |
| 0046 | Scopes on ships; `fleet:on-behalf` for plugins | Scopes on ships and in claims; `fleet:on-behalf` stays as it was (P6 gone) |
| 0034 | Selectors match ships | Selectors match ships and accounts by labels (question 5) |

- (a) **These changes, written as decisions after Thomas agrees the purpose.** Goes wrong: six decisions move at once.
- (b) **Only 0012 and 0020 now**, the rest when built. Goes wrong: the decisions disagree with each other until then.

Pick: (a).

## 5. What changes in phase 2's drafts

Not rewritten yet; this is what each would become under the picks above.

| Draft or flow | Change |
| --- | --- |
| [0051](phase-2/0051-organisation.md) Organisation | pagasae is no plugin ship: it signs claims and acts as the installation (questions 3, 4). The organisation, accounts and organisation admin stand |
| [0052](phase-2/0052-groups.md) Groups | A group gives scopes and labels in a claim, not on a person ship; a change lands at the next claim, no rescope. A person ship gets only what messaging needs, and its labels for message reach. P2's declared rules on `group` stand |
| [0053](phase-2/0053-nothing-is-argos-alone.md) Nothing is argo's alone | Stands, with "actor" for "ship": a scope may be held by an account. P4's commission check applies to the actor's labels. Plugin pages check the claim's scopes |
| [0054](phase-2/0054-sign-in.md) Sign-in | A sign-in yields a claim for one fleet. The gateway crews a person ship only for messaging. Console sign-in as argo unchanged |
| [0055](phase-2/0055-leavers.md) Leavers | The cut-off push (question 3) ends claims; pagasae releases as the installation (question 4); P6's widening of `fleet:on-behalf` goes. The trierarch's link to its account stands |
| [0056](phase-2/0056-outside-parties.md) Outside parties | Approving is an account's scope too, from the gateway's page. Otherwise stands |
| F1 Sign-up | No pagasae plugin ship at fleet create |
| F2, F3 Groups | No commission or rescope for rights; a person ship only at the first message |
| F4 Admin acts | Thomas and Mathilde act as their accounts, with claims; refusals the same |
| F5 Gateway sign-in | A claim for the fleet; crewing the person ship only when the human messages |
| F6 Console sign-in as argo | Unchanged |
| F7 Trierarch joins | The trierarch plugin's page acts for Burak's account; the ship's owner is his person ship (question 7) |
| F8 Disabled | Cut-off push to core; releases as the installation |
| F9, F10 Outside parties | The approver may be an account; otherwise unchanged |
