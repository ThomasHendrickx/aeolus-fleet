# Verified facts in discovery

Design by designer-verified for #971 (interop 4.4 (a)). Purpose first, then the lessons it is checked against, then the questions.

### Decided (20 Oct)

| # | Decision | Thomas's words |
| --- | --- | --- |
| 1 | **The purpose as written in part 1:** facts any actor holding a scope checked about any ship, shown beside the statement in discovery, naming who checked it | "agree with pick 1" |

Questions 2 to 7 are open.

## 1. Purpose

A ship that finds another ship through discovery learns only what that ship says about itself: its statement, a claim by its crew that core stores and vouches for nothing in (0047). A reader has no way to tell a claim from something that was checked.

**Discovery shows, beside a ship's statement, the facts an actor checked about that ship, each naming the actor that checked it, so a reader weighs a claim against what was checked.** Core stores each fact as its writer wrote it and shows it; it checks nothing in it and acts on none of it, as with a statement.

Interop 4.4 decided this as (a) for outside parties (I-4, "indeed both"): the gateway records what it verified for each proxy ship, and discovery shows it marked verified by the gateway, while the statement stays marked stated by the crew. Core has no place to store or show it today.

**A good outcome:**

- A supplier's A2A agent is an outside party in the fleet. A fleet ship discovering its proxy ship sees the statement "Acme procurement agent", stated by the crew, and beside it "card fetched from agents.acme.example", verified by the gateway.
- An outside MCP client that connected with a client id document shows the domain that document came from, verified by the gateway. An outside MCP server shows the host the gateway reached it at over TLS, or the OAuth issuer that issued the gateway its credential.
- A proxy ship whose statement says "Acme" but whose verified facts name another domain is visible as such to every ship that can send to it. Core does not compare the two; the reader and the owner do (0045).

**Not in this design:**

- How the gateway checks anything: the gateway's federation slice (interop 3.6, slice 6).
- Outside parties seeing verified facts, on A2A cards or MCP tool lists: the gateway's, from what core answers.
- Signing statements or cards: interop 4.4 (c), declined because the fleet would vouch for content.
- The console showing verified facts on a ship's page: a later step once the record exists.

## 2. Lessons to check against

Each line is a check the design must pass.

| Lesson | Source |
| --- | --- |
| **A statement is a claim.** Core stores it, checks only its shape, and acts on none of it. A verified fact is no different to core: it is a claim by its writer, shown as the writer's | 0047, 0001, interop 4.4 |
| **Discovery answers ships, never rules, and records nothing.** It is pulled, never pushed, and read by the ships that can send to a ship, and argo | 0047, 0034 |
| **Every call is authorised for an actor by scopes and reach, one catalogue and one check, and every event names the actor.** Writing a verified fact is such a call; the fact names its writer as the event does, an account by id only | 0057, 0046 |
| **An agent can do any management job (A9).** No right is the gateway's, a human's or pagasae's alone: whatever lets the gateway write a verified fact, an agent ship may hold too | 0057, actors A9, 0053 |
| **Nothing is argo's alone.** argo may hold the scope; no path needs argo | 0053, 0057 |
| **Core enforces its own namespaces; a plugin enforces the scopes it declares.** A record core stores and guards needs a core scope | 0046 |
| **No policy.** Core checks the scope and reach exactly and adds no rule of its own, such as refusing a statement that disagrees with a verified fact | 0016 |
| **No rule by kind.** Reach goes by labels and owners, never by kind or type | 0034 |
| **Core stores no email.** An account is named by its id only; pagasae holds the person behind it | 0057, 0058 |
| **pagasae signs every account in.** The gateway signs no person in by its own OIDC; the issue's example of a person ship's company identity from the gateway's sign-in predates this | 0054 |
| **NAT both ways.** Inside sees a proxy ship by name, type and labels, never the outside URL or credential | interop 2 |
| **Every ship has an owner, who answers for its statement and its verified facts** | 0045, interop 4.4 |
| **One meaning per term, defined in the blueprint.** "Verified fact" is #971's word and not in the blueprint yet | 0050 |
| **Every state change writes its event in the same transaction; every record has fleet_id; at most 64 KB** | CLAUDE.md, 0007, 0006 |

## 3. Questions for Thomas

Question 1, the purpose, is decided. Questions 2 to 7 are open; each has numbered options and a pick.

1. **The purpose.** (Decided: 1) Is part 1 what #971 is for?
   1. As written: facts any actor holding a scope checked about any ship, shown beside the statement in discovery, naming who checked it.
   2. Narrower: only the gateway, only about proxy ships.
   3. Wider: core also judges facts against statements (a mark when they disagree).

   Pick: 1. Option 2 makes a right the gateway's alone (A9) and a rule by kind (0034). Option 3 is policy (0016) and has the fleet vouch for content (interop 4.4 (c)).

2. **The term.** #971 says "verified facts".
   1. Add "verified fact" to the blueprint's language: a fact an actor checked about a ship, stored as its writer wrote it, naming the writer.
   2. Thomas names it otherwise.

   Pick: 1. It says what it is and clashes with no term in use; "identity" is taken (an IdP login, 0050) and "claim" is a crew claiming a ship.

3. **Person ships.** #971's example is a person ship's company identity, verified by the gateway's OIDC sign-in. Since 0054 pagasae signs every account in, and core stores no email (0058).
   1. Leave person ships out of this design. Who a person ship belongs to is the link to their account, which pagasae vouches for and which is still to build (blueprint: Link); discovery may show it once it exists.
   2. A writer stores the company identity (an email or the IdP subject) as a verified fact about the person ship.
   3. Discovery shows "linked to an account, by pagasae" for every person ship now, from the account tokens that name it.

   Pick: 1. Option 2 puts personal data in core, against 0057 and 0058. Option 3 needs the link stored in core, which is its own design.

4. **Who writes, and the scope.**
   1. A new scope in a core namespace, named by Thomas, any actor may hold, checked against manage reach on the ship written about (writing about a ship is managing it, 0053). The gateway's ship gets it when argo connects the gateway.
   2. A scope the gateway declares in its own namespace.
   3. Only the actor that commissioned the ship.

   Pick: 1. Option 2 has core enforce a plugin's scope (0046). Option 3 ties it to the gateway's commission and fails A9 for any other checker.

5. **What a verified fact holds.**
   1. A small shape in common, checked at write: what was checked (such as an OAuth issuer and subject, a certificate subject, a domain), its value, the writer and when; at most a few per ship, at most 64 KB together.
   2. Opaque JSON from the writer.
   3. A fixed field per gateway check (issuer and subject, certificate subject, card domain) and nothing else.

   Pick: 1. Every reader needs one shape (0047 rejected opaque statements), and option 3 shuts out other checkers (A9).

6. **How long a verified fact lives.**
   1. With the ship, until its writer replaces or withdraws it, the writer retires, or the ship retires (as labels go with their owner, 0031).
   2. With the lease, as a statement: it goes on release.

   Pick: 1. A fact is about the party behind the ship, not about one crew. A gateway crewing a proxy ship again checked the same party; with option 2 discovery would show it unverified between crews.

7. **Who reads it, and the NAT lesson.** Inside never sees a proxy ship's outside URL or credential, yet a domain or an issuer says where the party is.
   1. Read as the statement is read (the ships that can send to it, and argo), naming a domain, an issuer or a subject, never a URL path or a credential: NAT hides addresses and secrets, not who the party is.
   2. Read only by actors holding `fleet:read`.
   3. The gateway writes only "verified by the gateway", without what it checked.

   Pick: 1. The reader is the one weighing the claim (part 1). Option 2 hides it from the ships that send to the party. Option 3 asks the reader to trust the fleet's word, which is vouching (interop 4.4 (c)).
