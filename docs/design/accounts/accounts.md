# Accounts and roles: which human acts as which ship, and may do what

Design by designer-accounts, for Thomas's approval. Phase 1: the purpose, the lessons to check against, and the questions, each with its context, options and pick. Revised on 19 Oct for Thomas's decision that organisation is a concept of its own (1.3). Phase 2 (the options for the model, the decided model and its flows, happy and unhappy paths) follows Thomas's answers. No code.

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

Then, on where it lives: "an organisation manages the user accounts within the whole. Pagasae is the account management unit." The organisation and its accounts live in pagasae, signing in by email as pagasae's sign-in links already do; the gateway signs people in through those accounts until an outside directory is connected; core keeps ships, scopes and owners. This decides question 2 and raises question 25: pagasae today serves hosted Aeolus only.

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
| Whoever administers the organisation (accounts, fleets, later its directory) | nothing yet: the organisation has no record (question 4) | Nobody: the operator account is the fleet's one human |
| The operator | argo | One account, one session (0012) |
| Another human doing admin work (an IT admin, a team lead who connects their team) | argo today, so as the operator; the question is what instead (questions 5 to 8) | No way in but argo's session |
| A person in the organisation (Charlotte) | their person ship (0044) | A crew token pasted into their app; no sign-in |
| The owner of a ship, an app or an outside party (0045) | their person ship, which reaches the ships it owns | Exists as a fact; answers questions and trouble |
| A viewer | the viewer ship (0022) | A ticket from the hosting service |
| A person from another organisation (a supplier's employee) | nothing yet: outside parties are app ships (I-5) | No way in |
| The account holder at pagasae, who signs up for hosted Aeolus | becomes the fleet's operator, so argo | One account, one fleet |
| The person who runs the hosting service (pagasae's "owner") | no ship: they act on the installation, not in a fleet (0020) | pagasae's owner pages |

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
| **Approving an app is the most abused path.** People asking is good; people granting for themselves is how consent phishing works | Microsoft: user consent can be off, limited to verified publishers and low-impact permissions, or on; risky requests step up to admin consent; the admin consent workflow lets a user ask with a justification and named reviewers decide, and being a reviewer "doesn't elevate their privileges". Consent phishing gets account-level access that a password reset does not remove. Google: apps are Trusted, Limited, Specific data or Blocked; users can request an unconfigured app, which lands in "Apps pending review" | [consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview), [admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow), [illicit consent grants](https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants), [Google app access](https://knowledge.workspace.google.com/admin/apps/control-which-apps-access-google-workspace-data) |
| **An app's owner can hold less than the app.** Owning is answering for it, not a right to widen it | An Entra app owner has Application Admin rights on that one app, and the app can hold more permissions than its owner, which Microsoft names elevation of privilege. Ownerless apps are found again through the audit log; keep at least two owners | [app owners](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/overview-assign-app-owners) |
| **The directory decides who exists; leaving ends at the directory.** What the leaver owned is the hard part | Entra disables the account when HR records a termination, and lifecycle workflows can delete it days later. Google: suspend for a temporary block, delete only a leaver; only owned Drive files transfer, the rest is deleted, shared drives stay with the organisation | [HR provisioning](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/plan-cloud-hr-provision), [Google delete a user](https://knowledge.workspace.google.com/admin/users/delete-or-remove-a-user-from-your-organization) |
| **Assignment decides who may sign in to an app.** Otherwise everyone in the directory can | Entra's "assignment required": only assigned users sign in, and user consent is blocked for that app | [access management](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/what-is-access-management) |
| **Guests grow unseen.** A guest is a user in the host's directory whose home signs them in; the kind of user is apart from how they sign in | Entra's userType Member or Guest; by default anyone, guests included, can invite; access reviews remove guests who no longer answer | [user properties](https://learn.microsoft.com/en-us/entra/external-id/user-properties), [external collaboration](https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure), [guest access reviews](https://learn.microsoft.com/en-us/entra/id-governance/manage-guest-access-with-access-reviews) |
| **Time-bound admin rights came later, as governance.** | Entra PIM: eligible against active assignments, activation with MFA, justification and approval, access reviews, and it blocks removing the last Global Admin | [PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure) |

What Aeolus already has that they built on top: rights on the caller, not on a session (scopes on the ship); a where beside the what for every call (reach), not only for admin roles; an owner on every ship with argo as the fallback, so no app is ownerless. What it lacks: a sign-in that is not argo's, and any way to share argo's work.

## 3. Questions for Thomas (revised, 19 Oct)

The first list had 14 questions. Organisation answers some, changes most, and raises new ones; the gap list in `domain-model.md` adds the rest. Each gap there names the questions here that take it up.

**What became of the first 14:**

| First list | Now | Why |
| --- | --- | --- |
| 1 Account is a sign-in mapped to a ship | Changed: 1 | The account is the organisation's; in a fleet it acts as a ship |
| 2 Admin as argo or as own person ship | Stands: 5 | Fleet admin work; organisation admin is the new 4 |
| 3 Roles | Split: 4 and 6 | Rights over the organisation (4) differ from rights in a fleet (6) |
| 4 Which argo-only jobs become grantable | Changed: 7 | "Connect a person" becomes giving an organisation's account a person ship in a fleet |
| 5 Where an admin acts | Stands: 8 | |
| 6 How a person asks for an app | Stands: 9 | |
| 7 How the gateway finds the fleet | Changed: 11 and 12 | The gateway finds the organisation by its sign-in, then the fleet; the directory is later |
| 8 A person in more than one fleet | Changed: 12 | Several fleets of one organisation are now possible (3) |
| 9 Who comes in | Changed: 14 | The organisation's accounts, not the directory, decide |
| 10 A leaver | Changed: 15 | The organisation disables the account |
| 11 argo signing in at the gateway | Answered; what is left is 13 | The organisation's own accounts are the way in without an outside IdP (Thomas, point 2) |
| 12 Where accounts live | Decided: 2 | In pagasae, with the organisation (Thomas) |
| 13 A person from another organisation | Stands: 18 | Now also one human in two organisations |
| 14 The words "account" and "owner" | Changed: 20 | "Account" now has its home; "owner", "session", "connect" and "role" remain |

Questions 1, 3 and 4 decide the shape with question 2, which Thomas decided, and question 25, which it raises. The rest wait on them, and their picks assume mine.

### The shape

**1. A human is an account of the organisation, and in a fleet acts as a ship?** (gaps G1, G7, G15)

Context: today a human is five unlinked things (G1). Every caller in a fleet is a ship (0012), and a fleet's rights are scopes and reach (0034, 0046).

Options:

- (a) **An account belongs to one organisation.** In each fleet of the organisation it acts as at most one person ship; there its rights are that ship's scopes and reach, nothing else. Its rights over the organisation are question 4.
- (b) **An account carries rights in fleets too**, beside its ships' scopes, as Entra users carry roles.
- (c) **No account in Aeolus**: humans stay ships only, and the organisation is a label on ships.

Pick: (a). One model for every caller in a fleet, and the organisation gets the humans it manages. (b) gives a fleet two answers to "may this caller do that", which 0022 rejected. (c) cannot manage humans without a fleet, against Thomas's point 2.

**2. Where does the organisation live?** (G8, G24, G25, G28) **Decided by Thomas: pagasae**, "the account management unit".

The options it chose from: (a) core, above the fleet; (b) pagasae; (c) a component of its own. My pick was (c), a component generalising pagasae's pattern; Thomas's (b) is that pattern in the component that already has it. pagasae holds the organisation, its accounts and their email sign-in, and later the connected directory. It signs an account in to a fleet as a ship with a one-use ticket, as it signs the operator in today (0020), and it is the identity provider the gateway signs people in with (question 11). Core keeps ships, scopes and owners, and its tenant stays the fleet (0007). What a self-hosted fleet uses is question 25.

**3. One organisation with several fleets?** (G25, G26, G28)

Context: the principle reads "one organisation, one fleet, many actors" (blueprint Principles), but Thomas listed "which fleets it has" in organisation management. A fleet is one network: one set of rules, one argo.

Options:

- (a) **One fleet per organisation**, as the principle says.
- (b) **Several fleets per organisation** (a test fleet beside the real one, a department kept apart), each its own network; the principle becomes "one network per fleet, an organisation has one or more".
- (c) **Several, but only one in use at a time.**

Pick: (b). It is what Thomas's point 2 names, and an organisation keeps one set of humans across its fleets. It changes the principle's wording, which Thomas owns. (c) is (b) with a rule, against 0016.

**4. Who administers the organisation, and how are those rights held?** (G4, G8, G29)

Context: managing accounts, fleets and the directory happens above every fleet, where no ship is. Entra and Google answer with admin roles on the user, few holders of everything, narrower roles for daily work (part 2.2). 0046 rejected roles inside a fleet, where scopes do the work.

Options:

- (a) **Organisation rights on the account**: a small fixed set (manage accounts, manage fleets, manage the directory, everything), held in the organisation, checked by it. The one place a right is not a ship's, because there is no fleet there.
- (b) **An organisation's fleet holds them**: one fleet is the organisation's own, and its argo or scopes there manage the rest.
- (c) **Every argo** of the organisation's fleets manages the organisation.

Pick: (a). It names the exception plainly instead of bending "every caller is a ship" (0012) to a place without ships. (b) makes one fleet special and its network a policy point for the organisation. (c) puts organisation power in every fleet's operator. Whether the set is called roles is question 20.

### Admin work in a fleet

**5. Does a human doing admin work in a fleet act as argo, or as their own person ship?** (G7, G9, G10)

Context: J4. argo holds every scope and has one session at a time (0012); its events say argo.

Options: (a) several accounts crew argo, taking turns; (b) each admin acts as their own person ship, with scopes argo granted; argo stays for the few accounts given it (13); (c) one admin, argo.

Pick: (b). Every caller stays a ship, and events say which human acted. Few holders of everything, used rarely (part 2.2).

**6. Rights in a fleet: scopes one by one, or bundles?** (G4)

Context: 0046 rejected stored roles in a fleet. The core catalogue has 14 scopes.

Options: (a) scopes one by one; (b) presets in the console that grant a set of scopes and store only the scopes; (c) stored roles, reopening 0046.

Pick: (a), with (b) if granting by hand proves error-prone.

**7. Which of argo's alone jobs become grantable?** (G6, G10, G15)

Context: the gateway needs two done by others than argo: approve a party (J3), and give an organisation's account a person ship in this fleet (J2). The account already exists in the organisation; what is argo's today is commissioning the person ship (0044).

Options: (a) those two, each a scope argo grants; the rest stays argo's until a need shows; (b) every argo-only job; (c) none.

Pick: (a). It changes 0044 by one rule: a ship holding that scope commissions a person ship, for an account of the fleet's organisation only.

**8. Where may such an admin act?** (no gap; stands)

Options: (a) fleet-wide; (b) within their manage reach (0034); (c) a list per admin.

Pick: (b). Scope is what, network is where. Phase 2 works out how a ship that does not exist yet falls within reach.

**9. How does a person ask for an app?** (G15, G18)

Options: (a) a question (0038) to whoever approves; (b) a request list in the gateway's page; (c) people approve for themselves.

Pick: (a). (c) is the path consent phishing abuses (part 2.2).

### Signing in

**10. How do the organisation's own accounts sign in?** (G1, G13) **Answered by Thomas's lead: by email**, as pagasae's sign-in links do.

The options were: (a) email and password, and email link; (b) email link only; (c) passkeys from the start. With (b), core's password sign-in for the operator goes with the operator account (questions 13 and 25), and a self-hoster needs a way to send mail (question 25). Passkeys can come later without changing the model.

**11. How does the gateway sign people in?** (G13, G27)

Context: the gateway keeps one identity provider per fleet today (`IdentityProvider`) and would federate to it (I-4). Thomas's point 4: before Google is ready, people sign in with the organisation's accounts.

Options:

- (a) **pagasae is the gateway's one identity provider** (OIDC): the gateway always federates to pagasae, and pagasae federates to Entra or Google once the organisation connects its directory (17).
- (b) **The gateway reads accounts** from pagasae directly.
- (c) **The gateway federates to each directory** itself, as I-4 has it, and to pagasae for the rest.

Pick: (a). It is Thomas's lead ("the gateway signs people in through those accounts until an outside directory is connected"), and it gives the gateway one path whatever the organisation connects. It changes I-4's "the gateway's OAuth server federates to the company IdP" to "through pagasae", and the gateway's `IdentityProvider` moves to pagasae.

**12. How does the one address find the fleet?** (G12)

Context: Thomas decided one address for all fleets. The gateway's code serves one endpoint per fleet, `/fleets/<alias>/mcp`, and binds each token to it (gateway `916d431`).

Options:

- (a) **Sign in through pagasae, find the organisation from the account, then the fleet**: straight in when the account has a person ship in one fleet; a choice among them when several. The token names the fleet it was issued for.
- (b) **Keep an endpoint per fleet** behind the one address, reached by a redirect after sign-in.
- (c) **The person names the fleet.**

Pick: (a). It is the Microsoft 365 behaviour Thomas named, and a token still binds to one fleet (RFC 8707), so the gateway's code changes where the endpoint comes from, not the binding.

**13. Who crews argo?** (G2, G7, G9, G21)

Context: the operator account is the fleet's one human, and argo has one console session at a time (0012). With an organisation, an account is a human.

Options:

- (a) **An account given the right to crew argo of a fleet**, by the organisation's admins (4), signed in by a ticket from pagasae, as a hosted operator is today. The operator account folds in. Still one console session at a time; the session names its account.
- (b) **The operator account stays per fleet**, apart from the organisation's accounts.

Pick: (a). One kind of human account, and argo's way in stays independent of any outside IdP through the organisation's own sign-in (J5). Since several accounts may hold it, the session naming its account says who acted as argo (G9).

**14. Who gets a person ship?** (G15)

Context: 0044: only argo commissions person ships; ships created on first sign-in were rejected.

Options: (a) an admin gives an account a person ship (7) before the person reaches the fleet; (b) every account of the organisation gets one in every fleet at first sign-in; (c) a group of accounts named per fleet gets one at first sign-in.

Pick: (a). A ship exists because a human decided it; (c) can come with numbers.

**15. A leaver?** (G20)

Context: 0045: a retired owner's ships fall to argo.

Options: (a) the organisation disables the account: every sign-in ends, the person ships stay, and their owners are told by message; a human retires them; (b) disabling the account releases its person ships; (c) disabling retires them.

Pick: (a). Access ends where the organisation ends it; ships and what they own stay visible until a human decides (0045).

### Hosted, directories and outside people

**16. What becomes of the pagasae account?** (G14, G21, G28) Thomas's lead answers the home; what is left is how sign-up works.

Context: a pagasae account is one email, one fleet, its operator; its email is kept again in core's operator account (G14).

Options:

- (a) **Sign-up creates the organisation and its first account**, which administers it and may crew argo of its first fleet. pagasae keeps only what is hosted: the terms accepted, updates opt-in, the hosting service's own pages.
- (b) **pagasae stays the account store** for hosted organisations.

Pick: (a). One account per human, kept once, in pagasae. A self-hosted pagasae creates the organisation and its first account the same way (question 25).

**17. A connected directory, later: beside the own sign-in, or instead?** (G13, G27)

Context: Thomas's point 3. Google's super admins sign in with their Google password outside SSO; Microsoft keeps cloud-only emergency accounts (part 2.2).

Options: (a) beside: an account signs in through the directory once connected, and the accounts that crew argo keep the own sign-in; (b) instead: every account then signs in only through the directory; (c) the directory also creates accounts (provisioning).

Pick: (a), with (c) later when an organisation is large. The way in without an outside IdP stays (J5).

**18. A person from another organisation, and one human in two?** (G22, G30)

Options: (a) not yet: outside people come in as part of an approved party, and a human working for two organisations has an account in each; (b) an account of another organisation, invited into a fleet.

Pick: (a), until an organisation asks. Guests are the part of Entra that grows most unseen.

### From the gap list

**19. The party's owner is kept twice.** (G11)

Context: the gateway keeps the owner argo picked (`Party.ownerShipId`); core keeps the proxy ship's owner; `fleet.setOwner` changes only core's.

Options: (a) core's is the one; the gateway reads it; (b) the gateway's is the one, and setOwner on a proxy ship is refused.

Pick: (a). Every fact has one source of truth, and the owner is core's (0045).

**20. The words.** (G2 to G6)

Context: "account" (operator, pagasae, company), "owner" (a ship's, a label's, pagasae's), "role" (a squadron member's), "session" (an agent run, a console session, pagasae's), "connect" (argo's Connect, a plugin's connection).

Options:

- (a) **Each word one meaning, the others named in full**: "account" is the organisation's account; "owner" alone is a ship's owner, and a label's is always "the label's owner"; the organisation's rights of question 4 are not called roles, so "role" stays the squadron's; "session" is always qualified (agent session, console session); "connect" stays argo's Connect of a plugin, and a person is "given a person ship".
- (b) **Leave the words as they are**, defined per context.

Pick: (a), with Thomas naming the organisation's rights, since no blueprint word fits them.

**21. Plugin and trierarch ships are of kind agent.** (G16)

Context: 0044 asks to be true to what a ship is; an agent states a model, and these ships are processes.

Options: (a) kind app, an application; (b) a new kind; (c) leave them agents.

Pick: (a). The kinds already have the right word, and nothing reads kind for them. Outside accounts, it touches 0044 only.

**22. The machine's human.** (G17)

Options: (a) later, outside this design: a machine could name the account whose machine it is, once placement needs it; (b) now.

Pick: (a).

**23. A read-only look for one person.** (G19)

Options: (a) their person ship with `fleet:read`, within its read reach; the viewer stays the shared, anonymous look for the demo; (b) viewer sessions per account.

Pick: (a). The viewer ship stays what 0022 made it.

**24. What a person sees, outside argo's console.** (G7, G18, G23)

Context: questions go to the owner's ship (0038); the console's questions UI is frozen (0043); notices and the guide address console sessions.

Options: (a) a person's own app or chat, or the gateway's person tools (interop slice 3), shows their questions; notices and the guide stay argo's console's; (b) a person page in core.

Pick: (a). Core keeps its surface (0043).

### Raised by pagasae as the account management unit

**25. What does a self-hosted fleet use for its organisation and accounts?** (G21, G28, G31)

Context: pagasae is private (its README opens "Private") and hosted only: one account, one fleet, the early-access terms, the demo, the owner's pages for every fleet, mail through Resend. A self-hosted fleet today has no pagasae: a server command creates the fleet, argo and the operator account, who signs in to core with email and password (0012), and core has no installation procedures without a token (0020). Thomas's point 2 asks organisation management to work on its own, and Thomas's lead puts it in pagasae.

Options:

- (a) **pagasae is a component self-hosters run too.** It is published (its licence and visibility are Thomas's, 0049), its hosted parts (terms, updates opt-in, the demo, the owner's pages) are off unless configured, and it drives the self-hosted core through the installation procedures with its token, as it drives hosted core. Its sign-in mails links through a provider the self-hoster sets; without one, the link goes to the log, as it does locally today. Core's password sign-in and the server command that creates the operator go.
- (b) **Self-hosted keeps core's operator account**, with no organisation: organisation management only for hosted fleets.
- (c) **Core keeps a small organisation of its own** for self-hosted fleets, and pagasae for hosted ones.
- (d) **Self-hosted fleets use the hosted pagasae** for their accounts.

Pick: (a). One model hosted and self-hosted, in the component Thomas named, and core stays the fleet. Its costs: pagasae opens up and splits its hosted parts behind configuration; a self-hoster runs one more process and needs mail for sign-in; 0012's password sign-in and 0020's "a self-hosted server has none of them" change. (b) fails point 2 for every self-hoster. (c) gives accounts two homes and two models. (d) makes a self-hosted fleet depend on the hosting service for every sign-in, and its people's emails leave the self-hoster.
