# Accounts, phase 2: blueprint changes

What changes in `docs/blueprint.md` (as PR #972 leaves it) when the drafts are approved, section by section. Each entry names what it replaces and gives the new text. Sections not named stay.

## Principles

Replace "Every caller is a ship, people, apps and outside parties included: "One network to connect all." (0012, 0044)" with:

> - Everything that sends or receives messages is a ship, people, apps and outside parties included: "One network to connect all." (0044, 0057)
> - Every call is authorised for an actor (a ship, an account or the installation) by scopes and reach, and every event names that actor. An agent ship can hold any scope any actor holds, so an AI can manage the fleet (0057).
> - Nothing is argo's alone: argo is the fail-safe, the final level that catches all and the way out, not the holder of jobs no one else may do (0053, 0057).

## v1 scope

Replace the row **Operator login** with:

> | Signing in as argo | An account an organisation admin allows, by a sign-in ticket from pagasae that names it; or, where no pagasae runs, argo's own sign-in: an email and password `fleet:init` asks for and a server command resets (0054) |

## Users

Replace the opening "Aeolus has two kinds of users with equal standing: the human operator and the agent crewing a ship. The operator is a ship too, so an agent's question to a human is just a message to `argo`." with:

> Aeolus serves humans and agents with equal standing. An agent crews a ship. A human acts as their account, and sends and receives through their person ship; the operator is whoever signs in as argo, so an agent's question to the fleet's fail-safe is a message to `argo`.

**The operator ship (`argo`).** Replace three rows and add one:

> | Created with the fleet | Initialising a fleet creates `argo`, and where no pagasae runs, argo's own sign-in. `argo` has no secret |
>
> | Signing in | An account allowed to sign in as argo, with a sign-in ticket from pagasae, or argo's own sign-in, gets a session cookie. The console sign-in names its account, or says it is argo's own sign-in; every event argo's calls write carries it. That sign-in holds `argo`'s lease. The console is `argo`'s crew, so `argo` shows Crewed whether or not anyone is signed in. `register` with a secret is refused for `argo` |
>
> | Forgotten password | argo's own sign-in only: a server command resets it and ends argo's console sign-in |
>
> | The fail-safe | argo is the final level that catches all: the owner of every ship with no other, the way out for a ship that does not know what to do, permanent, with reach that is never off. It is not part of the delivery guarantee: no message is ever lost by the fleet itself (0057) |

Add after the viewer ship:

> ### A person (human)
>
> A human of the organisation, with an account in pagasae. They act as their account, with the scopes their groups give in each fleet, and have a person ship where a group lets them message (0052).
>
> | Job to be done | What Aeolus gives them |
> | --- | --- |
> | Reach the fleet from any client | The gateway's one address: sign in once through pagasae, from Claude, ChatGPT, Cursor or the gateway's own page (0054) |
> | Answer what my ships ask | Questions to my person ship, in my client or on the gateway's page (0038) |
> | Get an outside MCP server my agents need | Ask through the gateway; see "waiting for approval"; learn the outcome (0056) |
> | Do admin work I was trusted with | My account holds the scopes my groups give, within its reach; nothing needs argo (0053) |
>
> ### The organisation admin
>
> | Job to be done | What Aeolus gives them |
> | --- | --- |
> | Say who is in, with which rights | Accounts and groups in pagasae; a group gives scopes and reach in each fleet, landing at each account's next account token (0051, 0052) |
> | Take a leaver out | Disable the account: tokens cut off, sign-ins end, the person ships and linked trierarchs released, every ship stays (0055) |
> | Say who may act as argo | The accounts allowed to sign in as argo, per fleet (0054) |

## Access

Replace the opening "Two questions decide whether a ship may do something" with "Two questions decide whether an actor (a ship, an account or the installation, 0057) may do something", and in **Scopes say what**, "stored with the ship on the server" with "stored with the ship on the server, or carried in an account's token that pagasae signs (0058)".

In **Reach says where**, after "A selector picks ships by their labels or their owner, never by their type.", add:

> It matches an account by the `group` values in its account token, as it matches a ship by its labels.

Replace the **Owners** paragraph's last sentence, "Only argo changes an owner.", with:

> A ship an account commissions is owned by the account's person ship; a person ship that commissions owns what it commissions. An actor holding `fleet:owner` changes an owner, within its manage reach (0053).

Replace the paragraph **argo's alone** with:

> **argo is the fail-safe.** argo holds every scope and reaches every ship by a rule that is never off, so a fleet can always act; any other actor may hold every scope too. Nothing is argo's alone: commissioning a person ship (`fleet:person`), changing an owner (`fleet:owner`), explaining reach and reading refusals (`fleet:explain`), connecting a plugin (`fleet:connect`) and assigning any label (`labels:any`) are scopes, granted like any other, and a plugin's page checks the actor's scopes, not whether it is argo (0053). A grant, a change of owner and every manage call are checked against manage reach on the target. A commission grants only scopes the commissioner holds and gives only label values it defined or carries, so a new ship never reaches further than its commissioner can make it. A refused caller learns only that it was refused, so a refusal never maps the rules.

Add to **A worked example**, after its steps:

> With pagasae, step 1 is an organisation admin putting Charlotte, Thomas and Burak's accounts in groups that let them message; the installation commissions their person ships, labelled by group (0052).

## Domain language

Change these rows (the rest as PR #972 has them):

> | Scope | What an actor may do, `<namespace>:<action>`, stored with a ship or carried in an account token, never in a message; the only source of rights (0046, 0057) | core |
>
> | Approve | An actor holding the gateway's approving scope admitting an outside party to a fleet, naming its owner; the gateway then commissions its proxy ship (0056) | gateway |
>
> | Proxy ship | The app ship the gateway commissions for an outside party once it is approved (0044) | core |
>
> | Connect | Connecting a plugin to a fleet (`fleet:connect`): its commission. Nothing else connects; an account is linked | core |

Add:

> | Actor | Whoever a call is authorised for and an event names: a ship, an account (by its account token) or the installation. Not a ship: only what sends or receives messages is a ship (0057) | core |
>
> | Account token | A short token pagasae signs for one account in one fleet, with the scopes and labels its groups give there; core checks it on every call and stores no account. Not a crew token (0058) | pagasae, core |
>
> | Pending request | An outside MCP client's authorize request, or a person's request for an outside MCP server, kept by the gateway until an actor approves or denies it, or 7 days pass (0056) | gateway |

## Key flows

**Installation.** In step 1, "a name and the operator's email" becomes "a name" (core knows no organisation and no operator account): the fleet, its `argo`, the installation's scopes in it and, with a viewer, the viewer ship come in one transaction. Step 4, "Sign the operator in", becomes "Sign an account in as argo: the sign-in ticket names the account". Add:

> 8. End console sign-ins by an account: every console sign-in as argo by that account ends, with its event (0055).
> 9. Cut off an account's tokens: core refuses that account's tokens issued before now until the longest has ended (0058).

Add a section **Accounts**, after Installation, with the flows of `docs/design/accounts/phase-2/flows.md` as they are built: sign-up, an account joins a group, a group's rights change, an admin acts as their account, gateway sign-in, console sign-in as argo, a trierarch joins for an account, an account is disabled, an outside MCP client waits, a person asks for an outside MCP server, an account token is checked.
