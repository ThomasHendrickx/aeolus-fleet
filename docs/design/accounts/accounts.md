# Accounts and roles: which human acts as which ship, and may do what

Design by designer-accounts, for Thomas's approval. Phase 1: the purpose, the lessons to check against, and the questions, each with its context, options and pick. Thomas answered on 19 Oct; part 3 marks what he decided and rewrites what is still open. Phase 2 (the options for the model, the decided model and its flows, happy and unhappy paths) follows his answers to the open ones. No code.

The whole domain model, with accounts placed in it and the gaps it shows, is in [`domain-model.md`](domain-model.md).

Inputs:

| Input | Where |
| --- | --- |
| The blueprint's Access section, users and language | `docs/blueprint.md` on main |
| The decisions on the operator, kinds, owners, scopes, reach and core's surface | 0007, 0012, 0016, 0020, 0022, 0034, 0043 to 0047 |
| Scope rework part 0: single-operator assumptions (0.3), contained access (0.8), owners (0.10) | `design/scope-rework`, `docs/design/scope-rework/scope-rework.md` |
| The interop design: federation (I-4), the gateway commissions proxy ships once argo approves a party (I-5), no gateway without a networking plugin (I-3) | `design/interop`, `docs/design/interop/interop.md`; gateway slices 2, 3 and 6; issue #877 |
| pagasae, the account app for hosted Aeolus | pagasae `README.md` and `prisma/schema.prisma` |
| How Microsoft 365 (Entra ID) and Google Workspace model tenants, admin roles, app consent and guests | Their admin documentation, linked in part 2 |
| Thomas's direction for this design | The gateway has one address for all fleets: people sign in, then the gateway finds their fleet, as Microsoft 365 does |

## 1. Purpose

### 1.1 Today

Every caller is a ship, and a ship's scopes (what) and reach (where) decide every call. Humans are the exception: they get in through two doors, and each door gives the whole of one fixed ship.

| Door | Who | What it gives | Decision |
| --- | --- | --- | --- |
| The console, email and password (self-hosted) or a sign-in ticket from pagasae (hosted) | The one operator of the fleet | argo: every scope, every ship by every verb, one session at a time, a new sign-in takes the old one over | 0012, 0020 |
| A viewer ticket from the hosting service | Anyone the hosting service hands one (the hosted demo) | the viewer ship: `fleet:read` over every ship, many sessions at once | 0022 |
| A person ship's crew token, in the person's app or chat | Charlotte, Thomas, Burak in the worked example | their person ship, but no sign-in: someone pasted a starting prompt | 0044, 0015 |

So human access is a have-it-all policy: a human who needs to do any admin work at all needs argo, and argo is one account. The scope rework already listed what breaks once more humans arrive (0.3): one account and one console session, questions and trouble that all go to argo, squadrons writes served to argo alone.

pagasae, in front of hosted fleets, has accounts of its own: one email, signed in by email link, at most one fleet, whose operator that account is. Its "owner" is the person who runs the hosting service (`OWNER_EMAIL`), who sees every fleet's pages. That is not a ship's owner (0045): the word is taken twice.

### 1.2 What changes with the gateway

The gateway (interop slices 2, 3 and 6, issue #877) brings two new things that need a human's yes, and one door:

- **People sign in** with their company Google or Microsoft account, from their own Claude, ChatGPT or Cursor, to reach their own person ship. The chat then holds no crew token (0.8). Federation maps the company identity to the person's ship "by argo's mapping" (I-4).
- **Apps and outside parties ask to come in**, and someone must approve each one. Today that someone is argo, in the gateway's page, naming the owner who answers for the party (I-5).
- **One address for all fleets** (Thomas's decision): a person signs in at the gateway's one address, and the gateway finds their fleet from who they are, as Microsoft 365 finds the tenant from the account.

Who may approve an app, who may connect a person, and who may see or change what: that is account management, and Aeolus has none of it beyond argo.

### 1.3 Organisation (Thomas, 19 Oct)

Thomas decided, after reading the first version of this design:

1. Organisation is a concept of its own, in the domain model. Today it is only prose ("one organisation, one fleet", 0043), and the fleet stands in for it (0007).
2. Organisation management (its humans, their accounts, who administers what, which fleets it has) works on its own, without the gateway and without an outside identity provider.
3. Entra and Google are outside management that plugs in later: the organisation connects its directory. They are not the foundation.
4. So, before Google sign-in is ready, people sign in at the gateway with the organisation's own accounts.

Then, on where it lives: "an organisation manages the user accounts within the whole. Pagasae is the account management unit." The organisation and its accounts live in pagasae, signing in by email as pagasae's sign-in links already do; the gateway signs people in through those accounts until an outside directory is connected; core keeps ships, scopes and owners. This decided where the organisation lives and raises question 19: pagasae today serves hosted Aeolus only.

Where the organisation sits among every other concept, and the gaps it answers or raises, is in [`domain-model.md`](domain-model.md). The questions in part 3 are the revised list.

### 1.4 The jobs

| # | Job | Who needs it done |
| --- | --- | --- |
| J1 | **Sign a human in at one address, and find their fleet and their ship.** Nobody types a fleet name or pastes a token | Every person, at every sign-in |
| J2 | **Say which people of the organisation come in, and take them out when they leave.** A leaver loses access without a human remembering it | The organisation, through whoever administers it |
| J3 | **Approve an app or outside party**, and name the human who answers for it | Whoever the organisation trusts with that, not only argo |
| J4 | **Share the admin work** (connect people, approve apps, edit the network, grant scopes, answer trouble) among several humans, each with only what they need, and see afterwards which human did what | An organisation with more than one admin |
| J5 | **Keep a way in that never depends on an outside identity provider**, for when federation breaks or is misconfigured: the organisation's own accounts | The organisation |
| J6 | **See without changing**: a read-only look at the fleet | The hosted demo today; an auditor later |
| J7 | **Manage the organisation on its own**: its accounts, who administers what, which fleets it has, with no gateway and no outside identity provider; connect its directory later | Whoever administers the organisation |

### 1.5 Who the humans are

All in the blueprint's words. Each acts as a ship.

| Human | Acts as | Today |
| --- | --- | --- |
| Whoever administers the organisation (accounts, fleets, later its directory) | nothing yet: the organisation has no record (question 2) | Nobody: the operator account is the fleet's one human |
| The operator | argo | One account, one session (0012) |
| Another human doing admin work (an IT admin, a team lead who links their team) | argo today, so as the operator; the question is what instead (questions 3 to 6) | No way in but argo's session |
| A person in the organisation (Charlotte) | their person ship (0044) | A crew token pasted into their app; no sign-in |
| The owner of a ship, an app or an outside party (0045) | their person ship, which reaches the ships it owns | Exists as a fact; answers questions and trouble |
| A viewer | the viewer ship (0022) | A ticket from the hosting service |
| A person from another organisation (a supplier's employee) | nothing yet: outside parties are app ships (I-5) | No way in |
| The account holder at pagasae, who signs up for hosted Aeolus | becomes the fleet's operator, so argo | One account, one fleet |
| The installation admin, who runs the hosting service (pagasae's `OWNER_EMAIL`) | no ship: they act on the installation, not in a fleet (0020) | pagasae's owner pages |

### 1.6 A good outcome

In the worked example of the blueprint, at Acme:

- Acme's organisation has its own accounts. Mathilde created Charlotte's.
- Charlotte opens her Claude, connects the gateway's one address and signs in with her Acme account. She lands on her own person ship in Acme's fleet. Nobody gave her a token, and she never named the fleet. Once Acme connects Google Workspace, she signs in with her acme.com Google account instead, and nothing else changes.
- Mathilde, Acme's IT admin, approves the CRM's MCP client and names Thomas its owner. She does it as her own person ship, and the fleet's events say Mathilde did it, not argo.
- Thomas, team lead, connects the two people who join his team, and nobody else's.
- Burak leaves Acme. Mathilde disables his account (later: Acme's IT removes him from Google Workspace), and his next sign-in fails. The ships he owned are visible as his, and fall to argo when his ship is retired (0045).
- Federation breaks one morning. The accounts allowed to crew argo still sign in with the organisation's own sign-in.
- Every one of these steps is a ship acting within its scopes and reach, and leaves an event.

### 1.7 Not this design's

- The OAuth and federation mechanics of the gateway (the interop design and its slices).
- Network rules themselves (0034 to 0037): this design uses reach, it does not change it.
- The hosted sign-up in pagasae, except where a fleet's first human comes from it.

## 2. Lessons to check against

Each line is a check the model of phase 2 must pass.

### 2.1 From Aeolus

| Lesson | Source |
| --- | --- |
| **Every caller is a ship.** A human acts as a ship, never as a flag on a session. A read-only flag on argo's session was rejected as "one caller with two rights" | 0012, 0022, 0044 |
| **Scopes say what, reach says where.** Scopes live on the server with the ship, never in the request; reach comes from network rules selecting by labels or owner, never by type or kind | 0002, 0034, 0046 |
| **Roles that bundle scopes were rejected**: "a second concept beside scopes, and a role is a new word the fleet does not have. Solves nothing scopes alone do not." Any role here must answer that, or be raised as a question, not decided | 0046 (scope rework model C) |
| **A ship grants only what it holds.** Nothing widens itself | 0046 |
| **No policy.** Aeolus adds no protective rules; what scopes and reach allow is allowed, and the organisation decides who gets what | 0016 |
| **What is argo's alone today**: commission a person ship, change an owner, grant a plugin's scope besides the plugin, read refusals, explain reach, approve a party in the gateway, edit the network in the networking plugin, connect plugins. Anything J3 and J4 share comes out of this list | blueprint Access, 0034, 0036, 0044, 0045, I-5 |
| **A human is always responsible, without process for its own sake.** Left out until a need shows: lists to work through, handover flows, reviews, "a person record beside the person's ship" | 0045 |
| **Only argo commissions person ships**, and outside parties creating their own ships on first sign-in was rejected | 0044 |
| **One fleet is one tenant; a person is not a tenant.** A lookup before the fleet is known is a named exception (secret hash, token hash, operator email) | 0007, scope rework 0.4 |
| **Core is the fleet server, its API and argo's admin console.** People reach their ships through their own app or a chat; plugins serve their own pages | 0043 |
| **argo has one session at a time**: a sign-in takes the lease over. Several humans crewing argo would take each other over | 0012 |
| **No crew token in a chat** where the gateway can hold it | scope rework 0.8 |
| **Federation through the company IdP, not a second user directory**; leavers lose access when the IdP drops them | I-4 |
| **No hidden behaviour.** Every state change writes its event, naming the acting ship | 0.S, architecture |
| **Thin designs for few people; breaking changes allowed before 1.0.0** | 0013 |
| **Accounts outside core already work**: pagasae keeps accounts in its own store and signs one in to the console with a one-use ticket; core sees only the session crewing argo | 0020, pagasae |
| **Organisation is prose today**: the fleet stands in for it as the tenant | blueprint Principles, 0007, 0043 |

### 2.2 From Microsoft 365 (Entra ID) and Google Workspace

For lessons, not to copy.

| Lesson | What they do | Source |
| --- | --- | --- |
| **One address works because the identity carries its organisation.** The address is no tenant itself; the sign-in finds it | Microsoft's `login.microsoftonline.com/common` "serves across all Microsoft Entra tenants" and "isn't a tenant or an issuer itself"; the token's `tid` then names the tenant. Home realm discovery routes by the account's domain, and trusts a domain hint only for a verified domain | [multi-tenant apps](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant), [home realm discovery](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/home-realm-discovery-policy) |
| **The holders of everything are few, and not used daily.** Both had to grow narrow roles because one all-powerful role sprawls | Microsoft: fewer than five Global Admins, fewer than ten privileged assignments, a warning card past that; "a specific set of permissions, over a specific scope, for a specific period of time". Google: more than one super admin, each with a second account for daily work, signing in as super admin only for specific tasks | [Entra best practices](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices), [Google admin accounts](https://knowledge.workspace.google.com/admin/users/security-best-practices-for-administrator-accounts) |
| **Keep a way in that does not depend on federation.** | Microsoft: at least two cloud-only emergency access accounts, not tied to one person, alerted on every use, tested every 90 days. Google: super admins are not covered by the newer SSO profiles and sign in with their Google password | [emergency access](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access), [super admin SSO](https://knowledge.workspace.google.com/admin/apps/super-administrator-sso) |
| **Where an admin may act is a second axis beside what.** Both scope admin roles to a part of the organisation, and both found it hard to apply everywhere | Entra administrative units hold users, groups and devices; a role scoped to one applies there, not nested, and a group in a unit does not bring its members. Google: only some roles and privileges can be limited to an organisational unit | [administrative units](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/administrative-units), [Google prebuilt roles](https://knowledge.workspace.google.com/admin/users/prebuilt-administrator-roles) |
| **Approving an app is the most abused path.** People asking is good; people granting for themselves is how consent phishing works | Microsoft: user consent can be off, limited to verified publishers and low-impact permissions, or on; risky requests step up to admin consent; the admin consent workflow lets a user ask with a justification and named reviewers decide, and being a reviewer "doesn't elevate their privileges"; reviewers are emailed the request, and the user who asked is emailed when it is approved, denied or expires (after 1 to 30 days, the admin's setting). Consent phishing gets account-level access that a password reset does not remove. Google: apps are Trusted, Limited, Specific data or Blocked; users can request an unconfigured app, which lands in "Apps pending review" | [consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview), [admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow), [illicit consent grants](https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants), [Google app access](https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data) |
| **OAuth has no waiting approval in the code flow.** An authorize request ends in a redirect with a code or an error; a client not answered tries again. Only the device flow waits: its client polls and hears `authorization_pending` until a human decides | OAuth 2.1 and MCP's authorization use the code flow with PKCE; the device flow (RFC 8628) is for devices without a browser | [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628), [MCP authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization) |
| **An app's owner can hold less than the app.** Owning is answering for it, not a right to widen it | An Entra app owner has Application Admin rights on that one app, and the app can hold more permissions than its owner, which Microsoft names elevation of privilege. Ownerless apps are found again through the audit log; keep at least two owners | [app owners](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/overview-assign-app-owners) |
| **The directory decides who exists; leaving ends at the directory.** What the leaver owned is the hard part | Entra disables the account when HR records a termination, and lifecycle workflows can delete it days later. Google: suspend for a temporary block, delete only a leaver; only owned Drive files transfer, the rest is deleted, shared drives stay with the organisation | [HR provisioning](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/plan-cloud-hr-provision), [Google delete a user](https://knowledge.workspace.google.com/admin/users/delete-or-remove-a-user-from-your-organization) |
| **A change in a group changes rights in place.** The user stays; leaving deactivates it, delete is rare and late. The mapping from group to right lives in the application | Entra: app roles assigned to groups arrive as a token claim at the next token (1 hour by default), or SCIM pushes groups about every 40 minutes; leaving sends a disable, a delete follows after 30 days. Google Workspace: SAML sends groups at sign-in; a removed user is suspended after a delay the admin sets. Okta: group claims at sign-in, SCIM when an assignment changes; deactivates, never deletes. Slack: SCIM pushes groups, connected to workspaces and channels; deactivation signs out everywhere and keeps messages. GitHub: an IdP group is connected to a team, synced hourly or pushed by SCIM; leaving a group removes the team's access in place; a suspended user is restorable for 90 days. Most use claims at sign-in and a push for leavers who never sign in again | [Entra provisioning](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works), [app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), [Google group mapping](https://knowledge.workspace.google.com/admin/apps/about-group-membership-mapping), [Okta SCIM](https://developer.okta.com/docs/concepts/scim/), [Okta deactivate](https://help.okta.com/en-us/Content/topics/provisioning/lcm/lcm-automatic-deactivate.htm), [Slack IdP groups](https://slack.com/help/articles/115001435788-Connect-identity-provider-groups-to-your-Enterprise-Grid-org), [Slack deactivate](https://slack.com/help/articles/204475027-Deactivate-a-members-account), [GitHub team sync](https://docs.github.com/en/enterprise-cloud@latest/organizations/organizing-members-into-teams/synchronizing-a-team-with-an-identity-provider-group), [GitHub deprovisioning](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/provisioning-user-accounts-with-scim/deprovisioning-and-reinstating-users) |
| **Assignment decides who may sign in to an app.** Otherwise everyone in the directory can | Entra's "assignment required": only assigned users sign in, and user consent is blocked for that app | [access management](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management) |
| **Guests grow unseen.** A guest is a user in the host's directory whose home signs them in; the kind of user is apart from how they sign in | Entra's userType Member or Guest; by default anyone, guests included, can invite; access reviews remove guests who no longer answer | [user properties](https://learn.microsoft.com/en-us/entra/external-id/user-properties), [external collaboration](https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure), [guest access reviews](https://learn.microsoft.com/en-us/entra/id-governance/manage-guest-access-with-access-reviews) |
| **Time-bound admin rights came later, as governance.** | Entra PIM: eligible against active assignments, activation with MFA, justification and approval, access reviews, and it blocks removing the last Global Admin | [PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) |

What Aeolus already has that they built on top: rights on the caller, not on a session (scopes on the ship); a where beside the what for every call (reach), not only for admin roles; an owner on every ship with argo as the fallback, so no app is ownerless. What it lacks: a sign-in that is not argo's, and any way to share argo's work.

## 3. Questions for Thomas (answered 19 Oct)

Every word is a term of the blueprint's Domain language (decision 0050, PR #972). Thomas answered on 19 Oct. A decided question keeps its number and says his pick, in his words where he gave them; it is recorded as a decision when phase 2 is approved. An open one is rewritten for what he asked, with its context, a use case, what goes wrong under each option, and a pick. The gap list in `domain-model.md` names the questions that take each gap up.

| # | Question | Now |
| --- | --- | --- |
| 1 | One account, one person ship per fleet | Decided (a), with groups |
| 2 | Who manages the organisation | Decided (a) |
| 3 | Admin work in a fleet: argo or the human's own person ship | Decided (b) |
| 4 | How a change in a group reaches the person ship | Research done; open for a pick |
| 5 | Which of argo's jobs become grantable | Decided: all of them |
| 6 | Which ships a person ship with admin scopes acts on | Open, rewritten |
| 7 | How a person asks for an outside MCP server | Open, rewritten |
| 8, 9, 10 | Gateway sign-in, the one address, who signs in as argo | Decided (a) |
| 11 | Who gets a person ship | Decided (a), Thomas's wording |
| 12 | A leaver | Decided (a) |
| 13 | What sign-up creates | Decided (a), with the first fleet |
| 14 | A connected directory | Open, rewritten |
| 15 | A human from another organisation | Open, rewritten |
| 16 | The outside party's owner | Decided (a) |
| 17 | A leaver's computer | Open, rewritten |
| 18 | What a human sees | Decided (a), with where the inbox principle breaks |
| 19 | A self-hosted fleet | Open, option (e) added |
| 20 | How an outside MCP client learns it was approved | Decided (a) |

### The shape

**1. One account, one person ship per fleet. Decided: (a), with groups.** (G1, G4, G7, G15)

Thomas: (a) in spirit, but too simple. "Accounts sit in groups, and a group yields a set of scopes and network reach; the fleet only knows ships, so from the fleet's side an account has one person ship."

The model:

- A **group** is a set of an organisation's accounts, kept in pagasae (added to the Domain language). In each fleet, a group yields scopes and reach for the person ships of its accounts. An account in several groups gets every one of their scopes.
- Reach comes from network rules, which select by labels or owner, never by anything else (0034). So a group yields label values on its accounts' person ships, and the rules that select those values give the reach. Acme's group "engineering" yields `team=engineering` and `messages:send`; a networking plugin rule from `team=engineering` to `team=engineering` lets its people reach each other's ships.
- The fleet sees only the person ship, its scopes and its labels. Groups stay pagasae's.
- An admin may also give one account rights of its own (question 11); whether that is a group of one is phase 2's.
- How a change in a group reaches a live person ship is question 4.

Thomas's worry, that a human who uses the fleet and also does admin work needs two accounts: no. One account holds all three:

- organisation rights on the account, in pagasae (question 2);
- admin scopes in a fleet on their one person ship, through a group such as "fleet admins" (questions 3 and 5);
- leave to sign in as argo (question 10). That is the same account signing in to the console as a second ship, argo: a second ship, not a second account. The events name argo, and the console sign-in names the account.

Mathilde, Acme's IT admin, has one account, mathilde@acme.com. She is an organisation admin in pagasae. Her person ship in Acme's fleet holds what the groups "everyone" and "fleet admins" yield, and that is where her daily work happens. She is allowed to sign in as argo, and does so only to recover. Google tells a super admin to keep a second account for daily work (part 2.2); here the split is a second ship, so no second account is needed.

Nothing is left open here but question 4.

**2. Who manages the organisation, and how are those rights held? Decided: (a).** (G8, G29)

Thomas: "The account created first is the organisation's admin and manages the organisation." Organisation rights sit on the account, in pagasae: the one place a right is not a scope, because there is no fleet there. Not everything is managed through a fleet. An MCP server to manage the organisation from outside may come later.

### Admin work in a fleet

**3. Does a human doing admin work in a fleet sign in as argo, or act as their own person ship? Decided: (b).** (G7, G9)

Thomas: "The organisation admin is the organisation's; argo is the fleet's. Signing in as argo is something an account may be allowed to do." Admin work in a fleet is done as the human's own person ship, with the scopes their groups give (1); argo stays for the accounts allowed it (10).

**4. How does a change in a group reach the person ship? Research done; open for a pick.** (G4, G33)

Thomas turned this into research: how do applications that sign people in through a directory map its groups to rights in the application, when membership changes? His two candidate paths for ships: retire and recommission the person ship (ship recycling), or rescope a ship with no session attached.

What Entra, Google Workspace, Okta, Slack and GitHub do is in part 2.2 ("A change in a group changes rights in place"). What applies here:

- **Every one keeps the user and changes its rights in place.** None recreates it. Losing a group removes that group's rights from the same user; leaving deactivates it, and a delete is rare and late (Entra after 30 days, Okta never, GitHub only on a hard deprovision). This matches question 12.
- **The mapping from group to right lives in the application**, beside its own teams or channels (Slack, GitHub, Okta's group push). Only Entra keeps a coarse app role in the directory. Here the application is pagasae: the organisation's groups and what each yields in each fleet sit together.
- **A change arrives two ways.** At sign-in, as claims in the token (lands only at the next sign-in or token), and pushed (SCIM, from at once to about 40 minutes), so a leaver who never signs in again is still handled. Most use both.
- **A live sign-in keeps its rights until its token ends**, unless the application acts on the push. Slack signs a deactivated user out everywhere.

Aeolus already rescopes a live ship: `scopes:grant` takes effect at the ship's next call, with `ScopesChanged` (0046), and a label change moves reach at the next call (0034). A session attached does not block a rescope.

Use case: Charlotte moves from Acme's sales team to finance. Mathilde moves her account from the group "sales" to "finance" in pagasae. Charlotte is signed in at the gateway from her Claude, and her PRD agent is crewed.

Options:

- (a) **Rescope in place, at once.** pagasae changes the person ship's scopes and labels as soon as a group or its rights change, session or not. Charlotte's next call runs with finance's scopes and reach. A call that needed a removed scope is refused, as after any scope change.
- (b) **Rescope in place, at the next sign-in.** pagasae sets the scopes and labels when the account signs in. Goes wrong: Charlotte keeps sales' reach for as long as she stays signed in, and a removed right lingers.
- (c) **Rescope only with no session attached.** pagasae waits until the gateway's crew of the person ship ends. Goes wrong: the same as (b), and a human who never signs out is never rescoped.
- (d) **Retire and recommission (ship recycling).** A new person ship with the new scopes. Goes wrong: a new ship id; messages addressed to the old one and its history stay behind; the ships it owns (her PRD agent) fall to argo (0045). None of the five does this.

Pick: (a), with the same check at every sign-in as a backstop. Rights land once and at once, and a removal is not held up by a live session. It is the pushed path Slack and GitHub take, and core needs nothing new. Who changes the person ship in the fleet (pagasae through the installation procedures, or a ship of pagasae's in each fleet holding what it grants, 0046) is phase 2's, as for question 11.

**5. Which of argo's jobs become grantable? Decided: all of them.** (G6, G10, G15)

Thomas's rule: nothing argo does is argo's alone. Every job is a scope that can be granted. argo exists because the fleet only understands ships: it holds every scope, its built-in reach is never off (0034), and it can always act, so a permission bug never leaves a fleet unrecoverable without direct access to the database.

Decisions it touches:

| Decision | argo's alone today | Becomes |
| --- | --- | --- |
| 0044 | Only argo commissions a person ship | A scope; question 11 says who uses it |
| 0045 | argo alone changes an owner (`fleet.setOwner`) | A scope |
| 0046 | `explainReach`, `reachRefusals` and `fleet.setOwner` are "not scopes, argo's alone" | Scopes in the catalogue |
| 0034 | argo alone connects a plugin (`fleet.connectPlugin`) and explains reach | Scopes |
| 0022, 0034 | argo turns the viewer's read rule off | A scope |
| 0031 | argo assigns label values on any ship | A scope, within manage reach (6) |
| 0043, 0017, 0035 | Plugin pages (squadrons' writes, the networking plugin's rules) check a console sign-in as argo with `console.session` | They check the signed-in ship's scopes, so a person ship holding them works there too |
| Interop I-5 | argo approves an outside party on the gateway's page | A scope the gateway declares |
| 0012 | argo is permanent and holds every scope | Stays, with Thomas's reason as its why |

A ship still grants only what it holds (0046).

**6. Which ships may a person ship with admin scopes act on? Open, rewritten.** (G10)

Who: a human doing admin work acts as their own person ship, with the scopes their groups give (questions 1, 3 and 5). "Where" means which of the fleet's ships those scopes act on.

Use case: Acme's fleet holds the engineering team's ships, labelled `team=engineering`, and finance's, labelled `team=finance`, among them an agent that reads invoices. Thomas, engineering's team lead, is in the group "team leads", which yields `fleet:commission`, `fleet:manage` and `scopes:grant`. He should commission, rescope and retire engineering's ships, and nobody else's.

Options:

- (a) **Fleet-wide**: a scope acts on every ship. Goes wrong: Thomas can retire finance's invoice agent or rescope a finance person ship. Entra and Google added a second axis for admins for this reason (part 2.2).
- (b) **Within manage reach (0034)**: every `fleet:manage` call is already checked against manage rules on the target ship. A rule letting `team=engineering` manage `team=engineering` keeps Thomas to engineering's ships. Goes wrong: a ship that does not exist yet has no labels, so a commission cannot be checked against reach; phase 2 must say which labels a new ship carries (such as its commissioner's) before it counts as reached.
- (c) **A list of ships per admin**, kept beside reach. Goes wrong: two answers to "where", which 0034 closed.

Pick: (b). Reach is already the where for managing. The open part is a new ship's labels at commission.

**7. How does a person ask for an outside MCP server? Open, rewritten.** (G15, G18)

What it is: an outside MCP server is a service outside the fleet, such as a ticket tracker's MCP server, that ships call through the gateway. Approving it, the gateway commissions a proxy ship (kind app) with an owner and scopes, and network rules say which ships reach it (`domain-model.md` 2.5a). An outside MCP client asks for itself (question 20). A person's own MCP client (Claude, ChatGPT) needs no approval at all: it signs in at the gateway as their account and acts as their person ship (2.2).

Use case: Charlotte, at Acme, wants her PRD agent to read tickets from Linear's MCP server. Nobody has added it. Mathilde's person ship holds the scope to approve outside parties (5). Approving, Mathilde names its owner (Charlotte's person ship) and its scopes, and a network rule lets Charlotte's ships reach it.

Options:

- (a) **Charlotte asks in her chat, through the gateway's person tools.** The gateway keeps the request, shows it on its page to every ship holding the approve scope, and asks with a question (0038), which goes to the gateway's owner, argo. Charlotte sees "waiting for approval"; when Mathilde decides, Charlotte's person ship gets a message with the outcome. Goes wrong: a question reaches only the asker's owner, so Mathilde finds the request on the gateway's page, not in her own inbox.
- (b) **Charlotte sends a message to whoever approves**, Mathilde's person ship by name, and Mathilde adds the server on the gateway's page (2.5a). Nothing new to build. Goes wrong: Charlotte must know who approves; the request lives in a chat and is lost when Mathilde is away or leaves.
- (c) **Charlotte adds it herself.** Goes wrong: consent phishing. A server anyone adds receives what the agents send it; Microsoft restricts user consent for exactly this (part 2.2).

Pick: (a). Requests are kept in one place, the same as a pending outside MCP client (20), the person hears the outcome on their own ship, and nobody approves for themselves. Whom the gateway asks besides argo is phase 2's.

### Signing in

**8. How does the gateway sign people in? Decided: (a).** (G13, G27) pagasae is the gateway's one identity provider: every gateway sign-in goes through pagasae, and pagasae accepts identities from Entra or Google once the organisation connects its directory. I-4's "the gateway's OAuth server federates to the company IdP" becomes "through pagasae", and the gateway's `IdentityProvider` moves to pagasae.

**9. How does the one address find the fleet? Decided: (a).** (G12) Gateway sign-in through pagasae, the organisation from the account, then the fleet: straight in when the account is linked to a person ship in one fleet, a choice when several. The token names the fleet it was issued for.

**10. Which accounts may sign in as argo? Decided: (a).** (G2, G7, G9, G21) Accounts an organisation admin allows for that fleet, by a sign-in ticket from pagasae. Still one console sign-in at a time (0012); the sign-in names its account.

**11. Who gets a person ship? Decided: (a), in Thomas's wording.** (G15) An admin adds an account in pagasae and gives it rights (scopes, reach); that commissions its person ship. Later a group may be allowed, and the account's first sign-in commissions the ship, still on an admin's allowance. How pagasae commissions in the fleet is phase 2's (question 4).

**12. A leaver? Decided: (a).** (G20) The organisation disables the account: access ends at once, and the ship stays, like an inbox that outlives a leaver. Moving its work to another ship is a possible later feature. What a leaver's computer keeps crewing is question 17.

### Hosted, directories and outside people

**13. What does pagasae's sign-up create? Decided: (a), with the first fleet.** (G21, G28) Sign-up creates the organisation, its first account (an organisation admin allowed to sign in as argo of the first fleet) and its first fleet: zero fleets has zero value. pagasae keeps beside it only what is hosted: the terms accepted, updates opt-in, the hosting service's own pages.

**14. When the organisation connects Google Workspace or Entra, may its accounts still sign in by email? Open, rewritten.** (G13, G27)

What connecting changes: until then, every account signs in by email: pagasae mails a sign-in link (question 8). Connecting the organisation's directory lets an account sign in with its identity instead: Charlotte picks "Sign in with Google", Google answers charlotte@acme.com, and pagasae finds her account. Acme's own rules then apply to her sign-in (its passwords, its second factor), and a human Acme suspends in Google can no longer sign in that way.

Use case: Acme connects Google Workspace. Burak leaves; Acme's IT suspends him in Google, as it does for every tool. Then Google is misconfigured one morning and nobody can sign in through it.

Options:

- (a) **Identity for everyone; the email sign-in link stays only for the accounts allowed to sign in as argo.** Burak is out the moment Google suspends him. When Google breaks, Mathilde still signs in by email as argo and recovers. Goes wrong: on the morning Google breaks, everyone else waits.
- (b) **Identity only, for every account.** Goes wrong: when Google breaks, nobody gets in, argo included; Microsoft and Google both keep a way in outside federation for this (part 2.2).
- (c) **Both, for every account.** Goes wrong: Burak, suspended in Google, still signs in with a sign-in link if his mail still reaches him (forwarded, or a personal address), so Acme must disable him in two places.
- (d) **(a), and the directory also creates and disables accounts** (provisioning, as question 4's push). Goes wrong only in cost: worth it once an organisation is large.

Pick: (a), with (d) later. A leaver is out where the organisation ends him, and a way in without an identity provider stays (J5).

**15. A human from another organisation? Open, rewritten.** (G22, G30)

What an outside party is: an approved outside MCP server or client (0050). It is software, not a human: it acts in the fleet as a proxy ship (kind app) the gateway commissions and crews for it, with an owner in the fleet who answers for it.

Use case: Acme hires Priya, from the agency Northwind, for three months to build agents in Acme's fleet. Priya has an account in Northwind's organisation, priya@northwind.com.

Options:

- (a) **An account in Acme's organisation.** Mathilde adds priya@northwind.com to Acme's organisation and the group "contractors", and disables it when the contract ends. Priya has an account in each organisation; with one email in two, her gateway sign-in asks which organisation. Goes wrong: Acme must remember to disable her, since Northwind's directory does not tell Acme; and once Acme connects Google, Priya still signs in by email, as Acme's directory does not know her.
- (b) **A guest: Priya's Northwind account linked to a person ship in Acme's fleet.** Northwind signs her in. Goes wrong: an account then reaches into another organisation's fleet, across pagasae's tenant (0050); Acme does not list her among its accounts; guests grow unseen (part 2.2).
- (c) **Only through an outside party.** Northwind's own agent, an outside MCP client, is approved in Acme's fleet, and Priya works through it. Goes wrong: the events name Northwind's proxy ship, not Priya, and everyone at Northwind using that client is one ship to Acme.

Pick: (a). One account belongs to one organisation, and Acme decides who is in it. (c) stays right for a supplier's system rather than a person.

**16. The outside party's owner is kept twice. Decided: (a).** (G11) Core's owner is the one; the gateway reads it.

**17. A leaver's computer. Open, rewritten.** (G17, G20)

What it is: a trierarch runs on a computer, a laptop or a server. It crews its own app ship and starts the agent sessions there, each with a crew token (0026). Its ship is argo's (0045), and nothing ties a computer to an account.

Use case: Burak runs a trierarch on his laptop, crewing three of Acme's agent ships. He leaves, and Mathilde disables his account. Question 12 ends his access at once, but only his sign-ins end: his laptop's trierarch still holds crew tokens, and its agents still send and read in Acme's fleet until someone notices. So J2 needs this now.

Options:

- (a) **By hand**: an admin releases the trierarch's ship of a leaver's computer, found by its labels. Goes wrong: J2, a leaver loses access without a human remembering it.
- (b) **A computer names its account**: the trierarch's app ship is owned by the person ship of the account whose computer it is (changing 0045's "trierarch ships are argo's"). Disabling the account releases that ship and the leases it crews, so every crew token on the laptop stops working (0010); the agent ships stay and can be crewed on another computer. A shared server stays argo's. Goes wrong: a trierarch must name its account when it joins.
- (c) **Disabling an account releases every ship its person ship owns.** Goes wrong: it also stops ships crewed elsewhere, such as Burak's agent on a shared server that a colleague still relies on.

Pick: (b). It ends exactly what ran on the leaver's computer, and nothing else.

**18. What a human sees, outside argo's console. Decided: (a).** (G7, G18, G23, G34) A person's own app or chat, or the gateway's person tools, shows their questions; notices and the guide stay argo's console's.

Thomas's principle: a ship is like an email inbox; which client reads it does not matter to the network. It holds, with these exceptions:

- **One crew at a time.** A ship has at most one lease (0010), where an inbox takes many readers. Charlotte's Claude and ChatGPT both reach her person ship only through the gateway, which holds the one lease and serves both; a crew token pasted into a third app is refused while the gateway holds it.
- **argo opens only in core's console** (0012, 0043), by design: it is the way to recover (5).
- **The viewer opens only with a viewer ticket** (0022).
- **A pushed lease** (0040) changes how a delivery is confirmed, as the crew's computer side says. What is delivered stays the same.
- **Notices and the guide** address console sign-ins by kind (G23), and stay argo's console's.

**19. What does a self-hosted fleet use for its organisation and accounts? Open, option (e) added.** (G21, G28, G31)

Thomas leans to (b): pagasae is personal at this stage, and (a) adds a lot of complexity for self-hosters; the one-line console plus core setup would be gone for good.

Today a self-hoster runs `aeolus-core migrate`, then `fleet:init` (it asks for argo's email and password), then starts core and the console beside Postgres. No mail. pagasae today is private and hosted only: one account, one fleet, the terms, the demo, the installation admin's pages, mail through Resend.

Options:

- (a) **pagasae is a component self-hosters run too**, published, its hosted parts off unless configured; it drives core through the installation procedures; core's password sign-in goes.
- (b) **Self-hosted keeps core's email and password for argo**, with no organisation.
- (c) **Core keeps a small organisation of its own** for self-hosted fleets.
- (d) **Self-hosted fleets use the hosted pagasae.**
- (e) **Core keeps argo's own sign-in for the one-line setup** (one human, no organisation), and pagasae is an optional component that adds the organisation, hosted or self-hosted.

What each means for a self-hoster:

| | Setup | Processes | Mail | Organisation and gateway sign-in |
| --- | --- | --- | --- | --- |
| (a) | Today's, then pagasae: its database, its address, the installation token shared with core; the first account by sign-up | core, console, pagasae, Postgres with pagasae's database | Needed for every sign-in link, or links read from pagasae's log | Yes |
| (b) | Today's | core, console, Postgres | None | None: no accounts, so no gateway sign-in (it goes through pagasae, 8); argo only |
| (c) | Today's, plus core's organisation pages | core, console, Postgres | Needed for accounts' sign-in links | Yes, in a second model beside pagasae's |
| (d) | Today's, plus an account at the hosted pagasae joined to the self-hosted core | core, console, Postgres; a call to the hosting service at every sign-in | The hosting service's | Yes, but every sign-in depends on the hosting service, and people's emails leave the self-hoster |
| (e) | Today's; adding pagasae later is (a)'s setup | core, console, Postgres; pagasae once wanted | None until pagasae is added | None until pagasae is added; then yes |

Pick: (e). It is (b) today with the door open:

- The one-line setup stays, and one human needs nothing more.
- argo's own sign-in depends on nothing (no mail, no pagasae, no identity provider). That is Thomas's reason for argo (5) and J5's way in.
- The organisation has one model, pagasae's, wherever there is one; (c) gives accounts two homes.
- No work now: a self-hosted pagasae is built when a self-hoster asks for an organisation.

Its costs: once pagasae runs, argo has two ways in (core's own sign-in and pagasae's sign-in ticket), and the console sign-in must say which. And (e) bends 0050's "there is no operator account": core keeps an email and password that sign in as argo. Read as a sign-in of argo's own, with no organisation and no person ship, it is not an account; otherwise (e) reopens 0050, which is Thomas's call.

### Raised by flow 2.5

**20. How does an outside MCP client learn that it was approved? Decided: (a).** (G32) The gateway keeps the authorize request as pending and asks argo with a question (0038). The browser shows "waiting for approval" and goes on by itself if the answer comes while it is open; closed, the human at the client connects again and is answered at once. A deny ends the next try with `access_denied`. How long a pending request is kept is phase 2's.
