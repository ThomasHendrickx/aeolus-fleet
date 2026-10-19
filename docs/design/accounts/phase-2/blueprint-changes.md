# Accounts, phase 2: blueprint changes

What changes in `docs/blueprint.md` (as PR #972 leaves it) when the drafts are approved, section by section. Each entry names what it replaces and gives the new text. Sections not named stay.

## Principles

Add, after "Every caller is a ship":

> - Nothing is argo's alone: every job is a scope that can be granted. argo holds everything so a fleet can always act, never left unrecoverable by a permission bug (0053).

## v1 scope

Replace the row **Operator login** with:

> | Signing in as argo | An account an organisation admin allows, by a sign-in ticket from pagasae that names it; or, self-hosted, argo's own sign-in: an email and password `fleet:init` asks for and a server command resets (0054) |

## Users

**The operator ship (`argo`).** Replace three rows:

> | Created with the fleet | Initialising a fleet creates `argo`, and self-hosted, argo's own sign-in. `argo` has no secret |
>
> | Signing in | The operator signs in to the console as an account allowed to sign in as argo, with a sign-in ticket from pagasae, or with argo's own sign-in, and gets a session cookie. The console sign-in names its account, or says it is argo's own sign-in; every event argo's calls write carries it. That sign-in holds `argo`'s lease. The console is `argo`'s crew, so `argo` shows Crewed whether or not anyone is signed in. `register` with a secret is refused for `argo` |
>
> | Forgotten password | argo's own sign-in only: a server command resets it and ends argo's console sign-in |

Add after the viewer ship:

> ### A person (human)
>
> A human of the organisation, with an account in pagasae and a person ship in each fleet a group of theirs gives rights in (0052).
>
> | Job to be done | What Aeolus gives them |
> | --- | --- |
> | Reach my ship from any client | The gateway's one address: sign in once through pagasae, land on my person ship, from Claude, ChatGPT, Cursor or the gateway's own page (0054) |
> | Answer what my ships ask | Questions to my person ship, in my client or on the gateway's page (0038) |
> | Get an outside MCP server my agents need | Ask through the gateway; see "waiting for approval"; get the outcome as a message (0056) |
> | Do admin work I was trusted with | My person ship holds the scopes my groups give, within its manage reach; nothing needs argo (0053) |
>
> ### The organisation admin
>
> | Job to be done | What Aeolus gives them |
> | --- | --- |
> | Say who is in, with which rights | Accounts and groups in pagasae; a group gives scopes and reach in each fleet, applied at once (0051, 0052) |
> | Take a leaver out | Disable the account: sign-ins end, the person ships and linked trierarchs are released, every ship stays (0055) |
> | Say who may act as argo | The accounts allowed to sign in as argo, per fleet (0054) |

## Access

Replace the **Owners** paragraph's last sentence, "Only argo changes an owner.", with:

> A person ship that commissions a ship owns it. A ship holding `fleet:owner` changes an owner, within its manage reach (0053).

Replace the paragraph **argo's alone** with:

> **argo holds everything.** argo holds every scope and reaches every ship by a rule that is never off, so a fleet can always act. Nothing else is argo's alone: commissioning a person ship (`fleet:person`), changing an owner (`fleet:owner`), explaining reach and reading refusals (`fleet:explain`), connecting a plugin (`fleet:connect`) and assigning any label (`labels:any`) are scopes, granted like any other, and a plugin's page checks the signed-in ship's scopes, not whether it is argo (0053). A grant, a change of owner and every manage call are checked against manage reach on the target. A commission grants only scopes the commissioner holds and gives only label values it defined or carries, so a new ship never reaches further than its commissioner can make it. A refused sender learns only that it was refused, so a refusal never maps the rules.

Add to **A worked example**, after its steps:

> With pagasae, step 1 is an organisation admin putting Charlotte, Thomas and Burak's accounts in groups; pagasae commissions their person ships and labels them by group (0052).

## Domain language

Change these rows (the rest as PR #972 has them):

> | Approve | A ship holding the gateway's approving scope admitting an outside party to a fleet, naming its owner; the gateway then commissions its proxy ship (0056) | gateway |
>
> | Proxy ship | The app ship the gateway commissions for an outside party once it is approved (0044) | core |
>
> | Connect | Connecting a plugin to a fleet (`fleet:connect`): its commission. Nothing else connects; an account is linked | core |

Add:

> | Pending request | An outside MCP client's authorize request, or a person's request for an outside MCP server, kept by the gateway until a ship approves or denies it, or 7 days pass (0056) | gateway |

And in the kind `plugin` (decision 0050's list of plugins), add pagasae: in each fleet of an organisation it acts as its plugin ship (0051).

## Key flows

**Installation.** In step 1, "a name and the operator's email" becomes "a name, and whether pagasae is connected" (core knows no organisation): the fleet, its `argo`, pagasae's plugin ship when connected and, with a viewer, the viewer ship come in one transaction. Step 4, "Sign the operator in", becomes "Sign an account in as argo: the sign-in ticket names the account". Add:

> 8. End console sign-ins by an account: every console sign-in as argo by that account ends, with its event (0055).

Add a section **Accounts**, after Installation, pointing to the flows of `docs/design/accounts/phase-2/flows.md` as they land: sign-up, an account joins a group, a group's rights change, gateway sign-in, console sign-in as argo, a trierarch joins for an account, an account is disabled, an outside MCP client waits, a person asks for an outside MCP server.
