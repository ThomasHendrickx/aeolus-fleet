# Who a call acts for: ships, accounts and the installation

Design by designer-accounts, for Thomas. Thomas decided on 19 Oct that phase 2 is redesigned with pagasae not a ship, so pagasae needs a link of its own to core. The questions of phase 2's round 3 (P1 to P9, [`phase-2/README.md`](phase-2/README.md)) are on hold. This is phase 1 of that redesign: the purpose, the lessons to check against, the link between pagasae and core, and the questions, each with its context, a use case, options with what goes wrong, and a pick. No detailed decisions before Thomas agrees the purpose. No code.

Every word is a term of the blueprint's Domain language (PR #972), with "actor" and "account token", which Thomas named in question 1. Here it means whoever a call is authorised for and an event names: a ship, an account, or the installation.

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
- Actors: a ship (its crew token or console sign-in), an account (vouched for by pagasae; core checks a signed account token with its scopes and never stores accounts), the installation.

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
| A9 | **An agent can do any management job.** An agent ship can hold any scope a human or pagasae can, and do every management job through the same calls, so an AI can manage the fleet. No right is a human's or pagasae's alone (Thomas, 19 Oct) |

### 1.5 A good outcome

At Acme:

- Mathilde retires an agent from the networking plugin's page. She signs in through pagasae; the page calls core with her account token; the event names her account. She has no person ship in that fleet, because she never messages there.
- Charlotte talks to the CRM's app ship from her Claude: she sends messages, so she has a person ship, and the gateway crews it.
- Mathilde moves Charlotte from sales to finance. Charlotte's next account token carries finance's scopes; nothing is rescoped by a ship holding everything.
- Burak leaves. His account tokens stop being accepted within a minute, his person ship and his trierarch are released, every ship stays.
- pagasae is down for an hour. Fleets go on messaging; whoever signs in as argo by argo's own sign-in (self-hosted) still acts; account tokens already given keep working until they end.

### 1.6 Not this design's

- Messaging itself: inboxes, leases, delivery (0040).
- The organisation's model in pagasae (0051, 0052 as far as they hold).
- Network rules themselves (0034 to 0037), except which actor a rule's selector can match.

## 2. Lessons to check against

### 2.1 From Aeolus

| Lesson | Source |
| --- | --- |
| **The reason for "every caller is a ship" was that an AI can manage the fleet**: a ship commissioned with argo-like scopes does whatever argo does. That stays (A9): every option below is tested against it, and one that gives a right only a human or pagasae can hold goes wrong for that reason | 0012, Thomas 19 Oct |
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
| **The resource server need not store the humans** | Kubernetes has no object for a normal user: the API server checks an OIDC token's signature and expiry against the issuer's keys, without calling the issuer, and reads the user and groups from its account tokens. Service accounts, which are machines, are its own objects | [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/) |
| **Acting for someone is explicit and narrows** | GitHub: an app acts as itself (installation token) or for a user (user token), and then reaches only what both the user and the app may. Kubernetes impersonation needs its own grant | [GitHub on behalf of a user](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user), [impersonation](https://kubernetes.io/docs/reference/access-authn-authz/user-impersonation/) |
| **The audit names who acted apart from what was acted on, and both parties when one acts for another** | Entra: `initiatedBy` (a user or an app) and `targetResources`. GitHub: `actor` and `user`. Kubernetes: `user` and `impersonatedUser` | [Entra audit](https://learn.microsoft.com/en-us/graph/api/resources/directoryaudit), [GitHub audit fields](https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/audit-log-events-for-your-enterprise) |
| **A removed human keeps access until the token ends; keep tokens short** | Kubernetes: an id token "can't be revoked, it's like a certificate so it should be short-lived (only a few minutes)". Introspection (RFC 7662) revokes at once at the price of asking the issuer on every call | [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/), [RFC 7662](https://www.rfc-editor.org/rfc/rfc7662) |
| **Check issuer, audience, type and signature exactly; rotate by key id** | RFC 9068: `iss` matches exactly, `aud` holds the server's own identifier, `typ` is `at+jwt`, keys from the issuer's key set. A new key is published before it signs; an unknown key id makes the verifier fetch the set again. RFC 8707 binds a token to one resource | [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068), [OIDC key rotation](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys), [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) |
| **An issuer outage stops new sign-ins, not what runs** | Cached keys go on checking tokens not yet ended; access fades as they end. Servers that ask the issuer on every call fail at once (an inference from the above, not stated in one source) | as above |

## 3. The link between pagasae and core

What this part settles is how pagasae vouches for an account, so core can authorise the account's calls without storing accounts. The choices in it are questions 3 to 5; this shows the shape they choose within.

### 3.1 The shape

- **Trust is set up once per installation.** Core is configured with pagasae's issuer and fetches its public keys from it, as it is configured with the installation token today. With none configured, core accepts no account: a self-hosted fleet with argo's own sign-in only (Q19 (e)). Adding pagasae later is setting it.
- **pagasae signs an account token for one account in one fleet**: the account (an opaque id and its email, for events), its organisation, the fleet it is for (the audience, so it is refused in any other fleet), the scopes and labels its groups give there, and a short life. Whoever acts for the human presents it: the console, a plugin's page, the gateway, a human's MCP client.
- **Core checks it on every call**: the signature against pagasae's keys, the audience against this fleet, the life against now. It then authorises the call by the account token's scopes and reach, as for a ship, and names the account as the actor of every event the call writes. It stores nothing else about the account. When a plugin's page or the gateway presents the account token, the event names the account and, in its details, the ship it came through: who acted, and through what.
- **pagasae acting as itself** (a leaver's releases, a person ship for a human who starts messaging) acts as the installation in that fleet, through the same fleet calls a ship makes, with scopes argo gives it there (question 4). The installation procedures stay what they are: fleets, and sign-in tickets.
- **What only pagasae does is vouch for accounts**: issuing account tokens and cutting them off. That is signing humans in, not managing the fleet; no agent needs it, because an agent acts as its ship (A9).

### 3.2 Hosted and self-hosted

| | Hosted | Self-hosted, without pagasae | Self-hosted, with pagasae |
| --- | --- | --- | --- |
| Accounts in a fleet | Yes, through pagasae's account tokens | None: argo's own sign-in only | Yes, once core is configured with pagasae's issuer |
| Installation token | pagasae holds it | Unset (0020) | pagasae holds it |
| argo | Signed in by allowed accounts | argo's own sign-in | Both (0054) |

### 3.3 Unhappy paths

| What goes wrong | What happens |
| --- | --- |
| pagasae is down | No new account tokens: nobody signs in through pagasae. Account tokens already given keep working until they end; messaging goes on; argo's own sign-in still works where it exists. Hosted fleets have no other way in for humans until pagasae is back |
| pagasae rotates its key | It publishes the new key beside the old before signing with it; core fetches keys again when an account token names a key it does not know, at most once a minute, so a forged key id cannot make core fetch without end |
| An account token for a leaver is still alive | Accepted until it ends, unless pagasae tells core first (question 3). The life of an account token is the longest a leaver keeps access |
| An account token is stolen | Usable in its one fleet until it ends; that is why the life is short |
| pagasae's signing key leaks | Anyone can vouch for any account in every fleet that trusts it, as the installation token can create and delete fleets today. Rotating the key ends every account token at once |
| Core's clock and pagasae's differ | A small allowance on the life, so an account token is not refused for seconds |
| An account's groups change | The next account token carries the new scopes; an account token already given keeps the old until it ends (question 3) |

## 4. Questions for Thomas (answered, round 4)

Thomas answered all nine on 19 Oct: (a) each, with notes under questions 4, 6 and 9. Phase 2 is reworked on them; see [`phase-2/README.md`](phase-2/README.md).

**1. The principle, and the word for who a call acts for**

What it is: 0012's "every caller is a ship" becomes two rules: everything that sends or receives messages is a ship; every call is authorised for an actor by scopes and reach, and every event names that actor. "Actor" is used in the principle "one organisation, many actors" but is not a term of the Domain language.

Use case: Mathilde retires an agent from the networking plugin's page without a person ship; the event names her account.

- (a) **The two rules, and "actor" as the term**: a ship, an account or the installation. Goes wrong: a second kind of caller beside ships, which every check and every event must handle. A9 holds: a ship stays an actor, with any scope.
- (b) **The two rules, and another word** ("principal", as Entra and Kubernetes say). Goes wrong: a word new to the fleet, where "actor" is already in its principles.
- (c) **Keep "every caller is a ship"**, and pagasae a non-ship exception like the installation. Goes wrong: P1 and P6 stay, and every human who administers needs a person ship. A9 holds, as today.

Pick: (a).

Decided (Thomas, round 4): (a). "Actor" and "account token" are the terms.

The signed statement pagasae gives for an account (part 3) needs a word too. "Claim" is the field's word, but a crew already claims a ship (`ShipClaimed`), so this design says **account token**, after the crew token; it is Thomas's to name.

**2. Does a human acting in a fleet act as their account?** (reopens questions 1, 3 and 11)

What it is: phase 2 gives every human with rights in a fleet a person ship, and every call they make is that ship's. With accounts as actors, a person ship is needed only for messaging.

Use case: Mathilde administers Acme's fleet and never messages in it. Charlotte sends to the CRM and gets questions from her PRD agent.

- (a) **A human acts as their account in every call that is not messaging**; they have a person ship only when they send or receive (Charlotte yes, Mathilde no), and their messages are that ship's. Goes wrong: one human appears as two actors (their account, their person ship), so a history of "what did Charlotte do" reads both.
- (b) **A human always acts as their person ship** (phase 2). Goes wrong: Mathilde needs a ship she never messages from, pagasae must rescope it, and the gateway holds its lease.
- (c) **A human acts as their account for everything, messages included**, and a person ship is only their inbox. Goes wrong: a message whose sender is not a ship, which breaks answers, owners and reach for messages (A6).

A9, for every option: an agent acts as its ship, with the same calls and any of the same scopes an account's groups give; nothing here is for accounts only.

Pick: (a). Question 1 of `accounts.md` then reads: at most one person ship per account per fleet, and only when the human messages there. Question 3 (b) holds as "as their account, with their groups' scopes". Question 11 becomes: a person ship is commissioned when a human first messages in a fleet, on a group's allowance.

Decided (Thomas, round 4): (a).

**3. What core accepts from pagasae, and how a leaver is cut off**

What it is: the account token of part 3: what it carries and how long it lives.

Use case: Burak leaves at 10:00. Mathilde disables him. His Claude holds an account token given at 9:58.

- (a) **A short account token with scopes and labels, and a pushed cut-off**: lives 10 minutes; pagasae tells core "account disabled", and core refuses that account's account tokens until the longest of them has ended. Goes wrong: if the push is lost, Burak keeps access up to 10 minutes; core keeps a short list of cut-off accounts.
- (b) **Core asks pagasae about every account token** (introspection). Goes wrong: every call waits on pagasae, and when pagasae is down nobody but argo's own sign-in can act in any fleet.
- (c) **A long account token (a day), cut off only by the push.** Goes wrong: a lost push leaves a leaver in for a day; a group change takes a day.

Pick: (a).

Decided (Thomas, round 4): (a).

**4. What pagasae calls as itself, now that it is no ship** (replaces P1)

What it is: some changes have no human asking at that moment: sign-up's first fleet, a leaver's releases, a directory removing someone (later).

Use case: Burak is disabled; his person ship and his laptop's trierarch must be released in every fleet.

- (a) **pagasae acts as the installation in the fleet, through the same fleet calls a ship makes** (release, commission, grant), authorised by scopes argo gives the installation in that fleet and checked against reach like any actor's. Events name the installation, and their details the account and the organisation admin who asked. A9 holds: an agent ship holding `fleet:manage` releases the same ships with the same call. Goes wrong: a third kind of actor beside ships and accounts, and argo gives it scopes in each fleet.
- (b) **New installation procedures for one fleet**: release what a disabled account crews, commission or release a person ship. Goes wrong: A9; a second path for the same jobs, outside scopes and reach, which no ship can take.
- (c) **pagasae acts for the organisation admin who asked**, with that admin's account token. Goes wrong: an admin must hold every scope these need, and a directory change has no admin.
- (d) **pagasae is a plugin ship** (phase 2's P1). Rejected by Thomas.

What stays the installation's alone under (a), each tested against A9:

| Call | Who may call it | Why |
| --- | --- | --- |
| Release, commission, grant, labels in a fleet | Any actor holding the scope, within reach: an agent ship, an account, the installation | Fleet management: a scope (A9) |
| Create, list, get and delete fleets | The installation | Above every fleet: no fleet holds the scope, and a ship lives in one fleet. A ship that could delete its own fleet would end the fleet it acts in. Managing an organisation's fleets from an agent is question 9 |
| Sign-in tickets, ending console sign-ins as argo | The installation | Signing humans in, not managing: a ship never signs in as argo, and argo's scopes are open to a ship anyway |
| Cutting off an account's tokens | pagasae, which issued them | Signing humans in: it undoes what only the issuer vouched for. An agent acts as its ship and needs no account token |
| Limits, notices, the guide | The installation | The hosting service's own settings across fleets (0020, 0023, 0024), not a fleet's management |

So no fleet management job is the installation's alone; what stays its alone is above the fleet or is signing humans in.

Pick: (a).

Decided (Thomas, round 4): (a). Thomas: needed, since pagasae goes across fleets.

**5. How a rule reaches an account** (replaces P2 and P4)

What it is: network rules select ships by labels or owner (0034). An account is no ship and has no labels in core.

Use case: a manage rule lets `group=engineering` manage `group=engineering`. Thomas, as his account, retires an engineering agent, and must not retire a finance one.

- (a) **The account token carries the account's labels**, the values of pagasae's label `group` for its groups; a rule's selector matches an account by them as it matches a ship. A commission gives only label values the actor carries or defined (P4 as it was). Goes wrong: a rule's selector now matches two kinds of actor, and argo reading the rules must know an account can match.
  A9 holds: a ship's labels meet the same rules, so an agent ship labelled `group=engineering` manages what Thomas does.
- (b) **An account acts with its person ship's reach.** Goes wrong: every human with rights needs a person ship again.
- (c) **An account has scopes only, and reaches every ship.** Goes wrong: Thomas could retire finance's agent; reach stops saying where for humans.

Pick: (a).

Decided (Thomas, round 4): (a).

**6. What argo still is**

What it is: argo holds every scope so a fleet can always act (0053); with accounts as actors, someone could hold every scope without argo.

Use case: pagasae is misconfigured and every account token lacks scopes. Acme's fleet must still be put right.

- (a) **argo stays the fleet's own actor and inbox**: a permanent ship with every scope, its built-in reach, its inbox for what argo owns, signed in by allowed accounts or argo's own sign-in. Events name argo and the account that signed in. Goes wrong: nothing; by A9 an agent ship or an account may hold every scope too, so holding everything is not what makes argo. What makes argo is what no other actor has: it is permanent, its reach is built in and never off, and it has a way in that depends on nothing (argo's own sign-in, self-hosted). That is A7 kept by structure. Hosted, argo's way in is pagasae's sign-in ticket, so a hosted fleet's recovery depends on pagasae and the installation admin.
- (b) **argo becomes an account with every scope.** Goes wrong: recovery then depends on pagasae; a self-hosted fleet without pagasae has no argo; and the fleet's one holder of everything would be a human's, against A9's spirit.
- (c) **argo is an inbox only**, and its rights go to accounts. Goes wrong: the same as (b), and argo-owned ships' questions go to an inbox nobody acts from.

Pick: (a).

Decided (Thomas, round 4): (a). Thomas: argo is the fail-safe, the final level that catches all, so no faulty or missed state goes missing and there is always a way out: for a ship that does not know what to do, for a ship with no owner. That is not delivery: Aeolus's second promise holds that no message is ever lost and the operator is not the fail-safe for delivery. argo is the catch-all owner and the way out. And: "a message that reaches argo is a failing of the system, but it is visible through argo." So argo is where a system failure becomes visible and where the way out is, never a normal path; a design that routes ordinary work to argo is wrong.

**7. Who may own a ship** (0045)

What it is: an owner gets the ship's questions and trouble in its inbox (0038), so owners are ships today.

Use case: Thomas commissions an agent as his account. Who owns it, and where do its questions go?

- (a) **Owners stay ships**: a ship an account commissions is owned by the account's person ship, which is commissioned then if it has none, or by argo. Goes wrong: Thomas gets a person ship the moment he owns something, even if he never messages himself.
- (b) **An account may own**: its questions go to its person ship if it has one, else to argo. Goes wrong: questions for Thomas's agent land at argo; owner becomes two kinds.

Pick: (a). Owning means receiving, which is a ship's. A9: owning is answering for a ship, not a right (0045, "a human is always responsible"); owners stay a person ship or argo, and an agent manages whatever its scopes and reach allow, owner or not.

Decided (Thomas, round 4): (a).

**8. What the decisions become**

What it is: the decisions that say "every caller is a ship", or follow from it.

| Decision | Today | Becomes under picks 1 to 7 |
| --- | --- | --- |
| 0012 | Every caller is a ship; argo crewed by the console | Every call is for an actor; argo as question 6 (a) |
| 0020 | The installation: fleets only | Also an actor in each fleet, with scopes argo gives it, through the same fleet calls (question 4) |
| 0044 | Only argo commissions person ships; kinds | A person ship exists for messaging only (question 2); commissioning one is a scope an account may hold |
| 0045 | Owners are person ships or argo | Unchanged; an account owns through its person ship (question 7) |
| 0046 | Scopes on ships; `fleet:on-behalf` for plugins | Scopes on ships and in account tokens; `fleet:on-behalf` stays as it was (P6 gone) |
| 0034 | Selectors match ships | Selectors match ships and accounts by labels (question 5) |

- (a) **These changes, written as decisions after Thomas agrees the purpose.** Goes wrong: six decisions move at once.
- (b) **Only 0012 and 0020 now**, the rest when built. Goes wrong: the decisions disagree with each other until then.

Pick: (a).

Decided (Thomas, round 4): (a).

**9. Can an agent manage the organisation?**

What it is: question 2 of `accounts.md` put organisation rights (accounts, groups, which fleets, who may sign in as argo) on the account, in pagasae, where no fleet is. By A9 an agent must be able to do management jobs, and Thomas expects an MCP server to manage the organisation from outside later.

Use case: Acme runs an onboarding agent ship in its fleet. When HR hires Priya, the agent should add her account to the group "contractors" without Mathilde.

- (a) **pagasae's MCP server (later) accepts an agent ship of the organisation's fleets**, vouched for by core: core signs a short token for the ship, which pagasae checks, the reverse of the account token; an organisation admin gives that ship organisation rights in pagasae. Goes wrong: trust in both directions between pagasae and core; organisation rights held by a ship, in a place that knows no ships.
- (b) **An account for the agent**, as Kubernetes has service accounts. Goes wrong: 0050 made an account a human's; an agent with two identities (its ship and its account).
- (c) **Not now: organisation rights stay accounts'**, and an agent acts in fleets only. Goes wrong: A9 for the organisation: the onboarding agent cannot add Priya; recorded as a known gap until the MCP server comes.

Pick: (a) when pagasae's MCP server is built, (c) until then. The fleet's management stays open to agents now; the organisation's opens with its MCP server.

Decided (Thomas, round 4): (a). Thomas: for fleets without pagasae, argo is that way in.

## 5. What changes in phase 2's drafts

Not rewritten yet; this is what each would become under the picks above.

| Draft or flow | Change |
| --- | --- |
| [0051](phase-2/0051-organisation.md) Organisation | pagasae is no plugin ship: it signs account tokens and acts as the installation (questions 3, 4). The organisation, accounts and organisation admin stand |
| [0052](phase-2/0052-groups.md) Groups | A group gives scopes and labels in an account token, not on a person ship; a change lands at the next account token, no rescope. A person ship gets only what messaging needs, and its labels for message reach. P2's declared rules on `group` stand |
| [0053](phase-2/0053-nothing-is-argos-alone.md) Nothing is argo's alone | Stands, with "actor" for "ship": a scope may be held by an account. P4's commission check applies to the actor's labels. Plugin pages check the account token's scopes |
| [0054](phase-2/0054-sign-in.md) Sign-in | A sign-in yields an account token for one fleet. The gateway crews a person ship only for messaging. Console sign-in as argo unchanged |
| [0055](phase-2/0055-leavers.md) Leavers | The cut-off push (question 3) ends account tokens; pagasae releases as the installation (question 4); P6's widening of `fleet:on-behalf` goes. The trierarch's link to its account stands |
| [0056](phase-2/0056-outside-parties.md) Outside parties | Approving is an account's scope too, from the gateway's page. Otherwise stands |
| F1 Sign-up | No pagasae plugin ship at fleet create |
| F2, F3 Groups | No commission or rescope for rights; a person ship only at the first message |
| F4 Admin acts | Thomas and Mathilde act as their accounts, with account tokens; refusals the same |
| F5 Gateway sign-in | An account token for the fleet; crewing the person ship only when the human messages |
| F6 Console sign-in as argo | Unchanged |
| F7 Trierarch joins | The trierarch plugin's page acts for Burak's account; the ship's owner is his person ship (question 7) |
| F8 Disabled | Cut-off push to core; releases as the installation |
| F9, F10 Outside parties | The approver may be an account; otherwise unchanged |
