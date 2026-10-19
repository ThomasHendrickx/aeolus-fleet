# Accounts and roles: which human acts as which ship, and may do what

Design by designer-accounts, for Thomas's approval. Phase 1: the purpose, the lessons to check against, and the questions, each with its context, options and pick. Phase 2 (the options for the model, the decided model and its flows, happy and unhappy paths) follows Thomas's answers. No code.

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

### 1.3 The jobs

| # | Job | Who needs it done |
| --- | --- | --- |
| J1 | **Sign a human in at one address, and find their fleet and their ship.** Nobody types a fleet name or pastes a token | Every person, at every sign-in |
| J2 | **Say which people of the organisation come in, and take them out when they leave.** A leaver loses access without a human remembering it | The organisation, through whoever administers the fleet |
| J3 | **Approve an app or outside party**, and name the human who answers for it | Whoever the organisation trusts with that, not only argo |
| J4 | **Share the admin work** (connect people, approve apps, edit the network, grant scopes, answer trouble) among several humans, each with only what they need, and see afterwards which human did what | An organisation with more than one admin |
| J5 | **Keep a way in that never depends on the company's identity provider**, for when federation breaks or is misconfigured | The fleet's operator |
| J6 | **See without changing**: a read-only look at the fleet | The hosted demo today; an auditor later |

### 1.4 Who the humans are

All in the blueprint's words. Each acts as a ship.

| Human | Acts as | Today |
| --- | --- | --- |
| The operator | argo | One account, one session (0012) |
| Another human doing admin work (an IT admin, a team lead who connects their team) | argo today, so as the operator; the question is what instead (questions 2 to 5) | No way in but argo's session |
| A person in the organisation (Charlotte) | their person ship (0044) | A crew token pasted into their app; no sign-in |
| The owner of a ship, an app or an outside party (0045) | their person ship, which reaches the ships it owns | Exists as a fact; answers questions and trouble |
| A viewer | the viewer ship (0022) | A ticket from the hosting service |
| A person from another organisation (a supplier's employee) | nothing yet: outside parties are app ships (I-5) | No way in |
| The account holder at pagasae, who signs up for hosted Aeolus | becomes the fleet's operator, so argo | One account, one fleet |
| The person who runs the hosting service (pagasae's "owner") | no ship: they act on the installation, not in a fleet (0020) | pagasae's owner pages |

### 1.5 A good outcome

In the worked example of the blueprint, at Acme, which uses Google Workspace:

- Charlotte opens her Claude, connects the gateway's one address and signs in with her acme.com Google account. She lands on her own person ship in Acme's fleet. Nobody gave her a token, and she never named the fleet.
- Mathilde, Acme's IT admin, approves the CRM's MCP client and names Thomas its owner. She does it as her own person ship, and the fleet's events say Mathilde did it, not argo.
- Thomas, team lead, connects the two people who join his team, and nobody else's.
- Burak leaves Acme. Acme's IT removes him from Google Workspace, and his next sign-in fails. The ships he owned are visible as his, and fall to argo when his ship is retired (0045).
- Federation breaks one morning. The operator still signs in to the console as argo, as today.
- Every one of these steps is a ship acting within its scopes and reach, and leaves an event.

### 1.6 Not this design's

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

## 3. Questions for Thomas

Questions 1 and 2 decide the purpose and the shape. The others wait on them: their picks assume my picks on 1 and 2, and change if those do.

### The purpose

**1. Is account management only "which human acts as which ship", with every right staying the ship's scopes and reach?**

Context: today a human's rights are the rights of the ship their session crews (argo or the viewer). Entra and Workspace give rights to the user account itself, through admin roles. Aeolus already gives rights to ships, and every caller is a ship (0012).

Options:

- (a) **An account is a sign-in mapped to one ship.** The human's rights are that ship's scopes and reach, nothing else. Account management is: who signs in, as which ship, and what that ship may do.
- (b) **Accounts carry rights of their own** beside the ship's, as Entra users carry admin roles.
- (c) **Humans stay outside the fleet's model**: the gateway and pagasae decide who may do what, core sees only ships.

Pick: (a). It keeps one model for every caller, and the events name a ship, so they name a human. (b) puts two answers to "may this caller do that" side by side, which 0022 rejected. (c) moves policy out of core, against "policy stays in core" (interop 2).

**2. Does a human doing admin work act as argo, or as their own person ship?**

Context: J4 asks several humans to share the admin work and to see who did what. argo holds every scope, has one session at a time (0012), and every event it writes says argo.

Options:

- (a) **Several accounts crew argo.** argo's one-session rule goes; every admin holds everything; the events say argo.
- (b) **Each admin acts as their own person ship**, holding the scopes argo granted it for the work it does. argo stays, crewed by the operator, as the holder of everything and the way in that does not depend on the IdP (J5).
- (c) **One admin, argo; everyone else asks argo** by message, as today.

Pick: (b). Every caller stays a ship, and the events say which human acted. It is the lesson Entra and Workspace teach: few holders of everything, used rarely, and narrower rights for daily work. (a) loses who did what and keeps the have-it-all policy. (c) keeps argo the glue, which the principle "remove the human as the glue" rules out.

### Sharing the admin work

**3. Roles: a named bundle of scopes, or scopes one by one?**

Context: Thomas asked for "accounts and roles". 0046 rejected roles that bundle scopes as a second concept and a new word. Entra and Workspace have roles because their permissions number in the hundreds; the core catalogue has 14 scopes (0046).

Options:

- (a) **No roles.** An admin's person ship holds the scopes granted to it, one by one, as any ship.
- (b) **Presets in the console only**: a choice when granting that fills in a set of scopes, stored as nothing but the scopes it granted.
- (c) **Stored roles**: reopen 0046 model C, a role on a ship that changes when the role changes.

Pick: (a), with (b) as console polish if granting by hand proves error-prone. (c) would reopen a recorded decision; I raise it only because "roles" is in the task.

**4. Which of argo's alone jobs become grantable?**

Context: the gateway needs two jobs done by others than argo: approve an app (J3) and connect a person (J2: commission their person ship and map their company identity to it). The other argo-only jobs (change an owner, grant a plugin's scope, read refusals, explain reach, edit the network, connect plugins) have no new need yet.

Options:

- (a) **The two jobs the gateway needs**, each as a scope argo grants. The rest stays argo's until a need shows.
- (b) **Every argo-only job** becomes a scope.
- (c) **None**: argo does all of it.

Pick: (a). It answers J2 and J3 and leaves the rest where 0045's "grown where needed" puts it. Commissioning a person ship by a ship other than argo changes 0044; that is the one decision this touches.

**5. Where may such an admin act: anywhere in the fleet, or within their reach?**

Context: Entra scopes an admin role to an administrative unit; Workspace to an organisational unit. Aeolus already has a "where" for every call: reach, by labels and owner (0034), with manage reach for changing a ship.

Options:

- (a) **Fleet-wide**: holding the scope is enough.
- (b) **Within the admin's manage reach**: Thomas connects people only where his manage reach lets him (his team's label), approves only apps he may manage.
- (c) **A list per admin** of what they may act on, apart from reach.

Pick: (b). "Scope is what, network is where" already answers it, so nothing new is needed for the where. (c) is a second "where" beside reach. Phase 2 has to work out how a ship that does not exist yet (a new person, a new app) falls within reach.

**6. How does a person ask for an app, and who answers?**

Context: Entra's admin consent workflow and Workspace's "Apps pending review" let people ask for an app that someone else approves; people consenting for themselves is the path consent phishing abuses (part 2.2). Aeolus already has questions to a ship's owner (0038).

Options:

- (a) **A question** (0038) from the person's ship to whoever approves: their owner, or argo.
- (b) **A request list** in the gateway's page that admins work through.
- (c) **People approve apps for themselves** (user consent).

Pick: (a). It reuses what exists and lands where the person already answers things. (b) is a second inbox. (c) is the abused path.

### Signing in at one address

**7. How does the gateway find the fleet from a sign-in?**

Context: Thomas decided one address for all fleets. Entra's common sign-in finds the tenant from the account, and the token's tenant id (`tid`) names it; a domain counts only once it is verified (part 2.2). An email address alone is a weaker key: it is what the IdP reports, not what it vouches for.

Options:

- (a) **The company directory the fleet connected**: argo connects the fleet to its Entra tenant or Workspace organisation (by their ids, which the IdP vouches for), and the gateway routes a sign-in from that directory to that fleet.
- (b) **A verified email domain**: the fleet proves it holds acme.com (a DNS record), and the gateway routes by the domain of the address.
- (c) **The person types or picks the fleet.**

Pick: (a). It routes by what the IdP vouches for, not by an address, and one directory is one organisation is one fleet (principle "one organisation, one fleet"). (b) needs a proof flow of its own and still trusts the email claim. (c) breaks the one-address experience.

**8. A person who belongs to more than one fleet?**

Context: Google lets a person sign in to several accounts and switch between them; Entra sends a guest to their own organisation's sign-in.

Options:

- (a) **Not yet**: one company identity reaches one fleet; a second is refused with a clear reason.
- (b) **A picker** after sign-in, among the fleets that mapped this identity.

Pick: (a). One organisation is one fleet; a picker can come when a fleet shows the need (0013).

**9. Who comes in: only people someone connected, or anyone in the company directory?**

Context: 0044: only argo commissions person ships, and ships created on first sign-in were rejected. Entra can require assignment to an app, or let everyone in; Workspace switches an app on per organisational unit or group.

Options:

- (a) **Only connected people**: an admin (question 4) commissions the person ship and maps the company identity to it before the person's first sign-in. Anyone else in the directory is refused.
- (b) **Anyone in the connected directory** gets a person ship at first sign-in.
- (c) **A group in the IdP decides**: members of a group the fleet named get a person ship at first sign-in.

Pick: (a). 0044 stands, and a ship exists because a human decided it. (b) lets the directory create ships, which 0044 rejected. (c) is the sensible next step for a large organisation and can come with numbers.

**10. A leaver: what happens to their ship?**

Context: I-4: "leavers lose access when the IdP drops them". 0045: a retired owner's ships fall to argo. The person's app, here the gateway, holds their ship's lease (0.L).

Options:

- (a) **Sign-in fails, nothing else is automatic.** The gateway tells the person ship's owner (argo by default) by message when the IdP refuses a sign-in or a token refresh for a mapped identity; a human retires the ship.
- (b) **The gateway releases the lease** when the IdP refuses, and tells the owner.
- (c) **The IdP retires the ship** through provisioning (SCIM).

Pick: (a). Access ends at the IdP, where the organisation already ends it; the ship and what it owns stay visible until a human decides, which 0045 asks for. (c) has the fleet retire ships on another system's word, and the ships the leaver owned would fall to argo unseen.

**11. Does argo also sign in at the gateway with the company account?**

Context: J5. Microsoft keeps emergency access accounts that are cloud-only; Google's super admins sign in with their Google password, outside SSO (part 2.2).

Options:

- (a) **No**: argo signs in to the console as today, password or pagasae's ticket, independent of the IdP.
- (b) **Yes, and only that**: argo is a mapped identity like any other.
- (c) **Both.**

Pick: (a). argo is the way in when federation fails. The operator does daily work as their own person ship, signed in like anyone (question 2).

### Where it lives, and the words

**12. Where do accounts live: the gateway, core or pagasae?**

Context: the gateway already holds the OAuth server and federation (interop 3.5), and serves one address for all fleets, so it sits above fleets like an installation. Core holds ships, scopes, owners and reach. pagasae holds hosted sign-up. 0012 named Better Auth "if several human users ever come".

Options:

- (a) **The gateway** holds the sign-in, each fleet's connected directory and the mapping from identity to person ship; core holds only ships, scopes and owners, unchanged in kind.
- (b) **Core** holds person accounts (Better Auth), and the gateway asks core who someone is.
- (c) **pagasae** for hosted fleets, the gateway for self-hosted ones.

Pick: (a). Core stays "every caller is a ship" and gains no human directory, and the lookup before the fleet is known stays out of core (0007). (b) puts a user directory in core, against 0043 and I-4. (c) gives hosted and self-hosted two models.

**13. A person from another organisation?**

Context: Entra B2B adds them as guests in the host's directory, authenticated by their home. In Aeolus an outside party comes in as an app ship that argo approves (I-5).

Options:

- (a) **Not yet**: outside people come in as part of an approved outside party.
- (b) **A person ship whose identity comes from another directory**, approved as an app is.

Pick: (a), until a fleet asks. Guests are the part of Entra that grows most unseen.

**14. The words "account" and "owner"?**

Context: the blueprint knows "operator account" (argo's sign-in) and "owner" (of a ship, 0045). pagasae uses "account" for a hosted sign-up and "owner" for the person who runs the hosting service. This design needs a word for a human's sign-in mapped to a ship.

Options:

- (a) **"Account" for every human's sign-in**: the operator account, a person's account through the gateway, a pagasae account. "Owner" only for a ship's owner; pagasae's owner pages keep their name, since no fleet user sees them.
- (b) **No new use of "account"**: a person's sign-in is only a mapping on their ship.

Pick: (a). It is the word everyone already uses, and the blueprint has it. Phase 2 adds it to the blueprint's language with its one meaning.
