# End-to-end encryption: who can read a fleet's messages

Design run for Thomas's ask of 28 Oct 2026: "do a design run for end to end encryption". Backbone work, so this is the first part only: purpose, the lessons to check against, the options at a high level and the questions. Docs only. No mechanism is picked here; the detailed decisions, the flows and the slices follow once Thomas agrees the purpose and answers the questions.

Why now: Aeolus is about to be demoed to Belgian digital platforms that handle regulated data (Doccle, Silverfin, Qover). The site's trust page says today that messages are stored readable on the server, that the maintainer could reach them, and that end-to-end encryption is not available. The blueprint lists payload encryption under Deferred on purpose, with "Payloads are already opaque to the fleet" as its hook.

## 1. Purpose (to agree)

A company that puts regulated data in its fleet's messages can show its auditors who is able to read them, and the answer leaves out everyone who does not act on a message: whoever hosts the fleet, a copy of its database, another tenant, and Aeolus's maintainer.

**Whom it protects from:**

| From | Today | What the purpose wants |
| --- | --- | --- |
| A copy of the database: a backup, a nightly dump on the Storage Box, a disk, a restored snapshot | Every payload in it is readable | A copy alone reveals no payload |
| Another tenant on the same installation (one server hosts many fleets, 0020) | Kept apart by `fleet_id` on every query (0007); a scoping bug would show payloads | A scoping bug shows only what the other fleet cannot read |
| The hosting operator: whoever runs the installation (pagasae for hosted Aeolus) and its provider (Hetzner) | Can read every payload with database access | Cannot read a payload without the company's consent |
| Aeolus's maintainer, as the person with production access | Can read every payload, as the trust page says | Cannot read a payload without the company's consent |

**For whom:**
- The company's admin (the organisation admin and the fleet manager, 0051), who answers a vendor assessment and holds whatever key the company holds.
- Its people, whose person ships send and receive client data.
- Its ships, whose payloads carry client data between agents, apps and outside parties.

**What is true after:**
1. A copy of a fleet's database or backup, taken by anyone, reveals no payload.
2. Neither the hosting operator nor the maintainer can read a payload of a fleet that turned this on, without a step the company takes and can see.
3. The company can cut off every read of its payloads at once, and can see when they were read where it holds the key.
4. Both promises hold unchanged: stored before OK, never lost, handed again until acknowledged, a new crew inheriting the inbox (blueprint, Purpose; 0003; 0040).
5. The trust page states exactly who can read what, per option the fleet uses, and nothing more.

**What cannot be hidden, whatever is chosen:**
- **The ship that acts on a message reads it.** Aeolus distributes; the receiving ship executes (0001). An agent ship's crew, a person reading through the gateway, an app ship, an outside party's proxy ship: each is an end, and each sees the payload.
- **A model provider sees what the session sends it.** An agent ship's session puts the payload in its context, so Anthropic, OpenAI or whoever serves the model sees it, under the company's contract with them. Which provider and region is the company's choice (model governance, 0063), not this design's.
- **Routing, scopes and network rules need metadata.** Core must read the sender, the selector, the recipient ships, times, states, attempts, the content type, the payload's size, idempotency keys, ship names, labels, owners, scopes, the meeting a message belongs to and the schedule it came from. Every network rule check (0034), every limit (0020) and every clock (0040) runs on them.
- **What sits beside the payload is not a payload.** Report notes and details (0028), statements (0047), meeting titles (0061), commission notes and verified facts are stored readable today and are read by discovery and the plugins.

**Not the purpose:**
- Hiding the metadata above, or who talks to whom.
- Protecting against a compromised end: a laptop running a trierarch, a session's transcript, the receiving app.
- Encrypting the content a message refers to. A payload carries a reference (0006): the repository, storage URL or document it points to keeps its own protection.
- Signing messages or proving who sent one (the blueprint's separate deferred item, per-message signing).
- Hiding a payload from the model provider of the session that handles it.
- A certification or a legal opinion on GDPR, DORA or NIS2.

## 2. Lessons to check against

### 2.1 How others did it

| # | Lesson: what it hides, from whom, and what it costs | Source |
| --- | --- | --- |
| L1 | **Signal** hides content from the server; every device holds its own keys and a sender encrypts once per recipient device. Costs: a new device starts without history unless moved from the old one, no server-side search, and the server still sees who talks to whom (sealed sender hides the sender only partly). Forward secrecy and recovery after compromise come from ratcheting keys per message. | [Signal specifications](https://signal.org/docs/) (Double Ratchet, X3DH, PQXDH, Sesame); [sealed sender](https://signal.org/blog/sealed-sender/) |
| L2 | **MLS** (RFC 9420) hides content from the delivery service for groups of up to thousands, adding and removing members in logarithmic cost through a ratchet tree. Costs: every member keeps group state per device, the delivery service must order commits per group, members publish key packages ahead, and a new member reads nothing sent before it joined, by design. | [RFC 9420](https://www.rfc-editor.org/rfc/rfc9420); [RFC 9750, MLS architecture](https://www.rfc-editor.org/rfc/rfc9750) |
| L3 | **Matrix Megolm** hides room content from homeservers: each sender's device ratchets one group session and shares it with every recipient device over Olm. Costs: a new or lost device misses keys ("unable to decrypt"), so history needs a server-side key backup encrypted with a recovery key, and device verification (cross-signing) becomes the user's chore. Matrix is moving towards MLS. | [Matrix spec, end-to-end encryption](https://spec.matrix.org/latest/client-server-api/#end-to-end-encryption); [Megolm](https://gitlab.matrix.org/matrix-org/olm/-/blob/master/docs/megolm.md) |
| L4 | **WhatsApp** runs the Signal protocol across companion devices, each with its own keys, and offers encrypted backups whose key sits in an HSM vault behind a password, or a 64-digit key the user keeps. A business on the Cloud API is an end that Meta hosts: the chat is end-to-end to the business's vendor, and WhatsApp says so to the user. | [WhatsApp security whitepaper](https://www.whatsapp.com/security/WhatsApp-Security-Whitepaper.pdf); [encrypted backups](https://www.whatsapp.com/security/WhatsApp_Security_Encrypted_Backups_Whitepaper.pdf) |
| L5 | **Slack Enterprise Key Management** encrypts messages and files with keys from the customer's AWS KMS; the customer revokes access per workspace, channel or time range and sees every key use in its own logs. Slack's running service still reads content, so search and every feature keep working. Costs: an Enterprise Grid feature, a KMS the customer runs, and revoked content gone for every user. | [Slack EKM](https://slack.com/enterprise-key-management) |
| L6 | **Customer-managed keys (AWS KMS, Azure Key Vault)** use envelope encryption: data keys encrypted by a key in the customer's account, which the service asks to unwrap. It hides data at rest and in backups, gives the customer a kill switch (revoke, or destroy the key to shred everything) and an audit trail of each use; it does not hide data from the running service. Costs: the KMS on the service's hot path (an outage stops reads), per-call charges, and data keys cached for speed. | [AWS KMS concepts](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html); [Azure data encryption models](https://learn.microsoft.com/azure/security/fundamentals/encryption-models) |
| L7 | **Microsoft Double Key Encryption** goes one step further: a second key held only by the customer, so Microsoft's services cannot read the content. Microsoft says to keep it for the few most sensitive items, since search, previews and its own assistants stop working on them. | [Double Key Encryption](https://learn.microsoft.com/purview/double-key-encryption) |
| L8 | **Proton** stores mail encrypted with the user's key (zero-access): mail from outside is readable on arrival and encrypted then; subjects, senders and recipients stay readable to Proton. The private key is protected by the user's password, so a reset without a recovery phrase or file loses old mail; search runs on the device. A business admin may hold an organisation key that resets members' keys. | [Zero-access encryption](https://proton.me/blog/zero-access-encryption); [Proton Mail encryption explained](https://proton.me/support/proton-mail-encryption-explained) |
| L9 | **Tresorit** encrypts files on the client and wraps each file key for each member, so the server holds nothing readable and cannot preview or search content. Business plans add an admin-controlled recovery so a lost password does not lose the company's files. | [Tresorit security](https://tresorit.com/security) |
| L10 | **Web apps that decrypt in the browser** trust the code the server sends each time: whoever serves the page can send code that reads the key. Proton and Tresorit live with it for the web and offer installed apps for those who will not. | L8, L9 |
| L11 | **Regulated buyers ask the vendor question first.** GDPR article 32 names encryption among the measures; DORA, in force for financial entities since 17 Jan 2025, makes them assess each ICT provider's access to their data. A vendor assessment asks "can your staff read our data, and can we cut you off". Not legal advice. | [GDPR art. 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj); [DORA](https://eur-lex.europa.eu/eli/reg/2022/2554/oj) |

What the lessons share: every scheme that keeps the host out pays in recovery, new devices and server features; every scheme that keeps server features (L5, L6) keeps the running service in. Groups are solved (L2) but bring per-member state and an ordering service.

### 2.2 The fleet's own facts a design must keep

| # | Fact | Why it matters here | Source |
| --- | --- | --- | --- |
| F1 | **Stored before OK, never lost.** A send answers OK only once the message and its deliveries are committed. | Encryption happens before the send or inside it; a missing key must refuse the send, never store something no one can read. A lost key is a lost message, so recovery is part of the promise. | 0003; blueprint, Purpose |
| F2 | **Idempotent sends.** A repeat with the same key and the same request returns the original; a different request is refused. The request's hash covers the payload. | A client that encrypts with a fresh nonce on each retry sends a different request and is refused. A retry must resend the same ciphertext. | architecture, `messages` |
| F3 | **Redelivery and restart.** A delivery is handed again until acknowledged; a released lease returns it to pending; a new session, on any computer, inherits the inbox. | The key belongs to the ship, not to the session or the computer: whatever crews the ship next must read what waits. | 0010; 0040; blueprint, Crash recovery |
| F4 | **Recipients unknown at send.** A send to a type goes to whichever ship of the type takes it, a new one included (0041); a label resolves at send (0065); a schedule may send to a label later (0062); a meeting adds participants and lets them rejoin (0061). | Per-recipient encryption cannot work for a type or a later schedule; a meeting needs group keys that change as participants come and go (L2). | 0041; 0061; 0062; 0065 |
| F5 | **Resend.** An undeliverable or not handled delivery is resent, with read reach, as a new message naming the original (resend-of). | Core carries the original's content again without reading it; the recipient must still hold a key that opens it, even after a key rotation. | 0034; 0040; architecture, `messages` |
| F6 | **Retention and pruning.** Finished messages go hourly past the fleet's window; open deliveries and open questions never go. | Unchanged by any option: pruning reads states and times only. Destroying a key would shred a whole fleet at once, a second way of deleting. | 0066; retention design |
| F7 | **64 KB payloads, references not content.** `message_days` counts payload bytes for limits. | Encryption adds bytes, so 64 KB of plain text no longer fits; the limit must say whether it counts plain text or ciphertext. Most sensitive content may already live behind a reference, outside Aeolus. | 0006; architecture, `message_days` |
| F8 | **The gateway reads payloads.** As crew of person ships it shows messages in MCP clients and its pages (`aeolus_open`), and wakes people; as crew of proxy ships it turns a message into an outside MCP tool call or A2A message and replies back; it posts messages into Slack and turns Slack messages into sends, rendering Markdown and questions as buttons. | The gateway is an end for every person ship and every outside party. In hosted Aeolus it runs at the hosting operator, so it reads what reaches those ships, whatever core stores. Slack, an outside MCP server and an A2A agent then hold the content too. | 0054; 0056; 0060; gateway-scopes design, part B; re-read-delivery design |
| F9 | **The console and argo read messages.** The operator inbox renders `text/markdown` on the console's server; a message's page shows its thread; `fleet:read` reads a message through its sender or recipient within read reach; the viewer reads every ship. Console logic runs on the server, never in the browser. | A hosted console that renders payloads on its server reads them. Decrypting in the browser would reopen decision 0033 and bring L10's weakness. argo is the fail-safe and must be able to read what reaches it. | 0012; 0022; 0033; 0034; blueprint, Operator inbox |
| F10 | **Plugins read messages.** Squadrons, the trierarch plugin and the gateway read fleet-wide by the built-in plugin rule, and read on behalf of a person's ship (`Aeolus-On-Behalf-Of`); squadrons take check-ins and send roles as messages. | Each plugin that reads a payload is an end; in hosted Aeolus they run where core runs. | 0034; 0046; 0017 |
| F11 | **Crews that cannot hold a key.** A chat with no shell (Claude chat, ChatGPT) crews a ship over `/mcp` with the crew token in the conversation; a REST-only ship is whatever its builder wrote. | A session that only calls core's tools cannot decrypt anything core does not decrypt for it. | 0015; blueprint, Starting prompt |
| F12 | **No search, payloads never logged.** Core never parses a payload and pino never logs one. Audit is the event log, which carries no payload. | Nothing in core searches payloads, so sealing them breaks no search. Audit and the timelines keep working from events. | blueprint, Content-blind; architecture, Logging and Security baseline |
| F13 | **Support works from what the fleet stores.** Today a maintainer can read a payload to debug a stuck delivery. | After, support for a sealed fleet works from metadata and events, as stuck deliveries already do (0042). | 0041; 0042 |
| F14 | **Hosted and self-hosted.** One server hosts many fleets for pagasae; anyone may run their own fleet, where the company is its own hosting operator. | For a self-hosted company only the copy and the scoping bug remain as threats; for hosted, the host and maintainer are the threat the trust page names. | 0020; blueprint, Distribution |
| F15 | **The maintainer publishes the code.** core, the trierarch, the plugin and the gateway are released by Thomas's trains. | Against the maintainer, end-to-end holds only as far as the company runs code it pinned and can check, the web's L10 weakness in another form. | 0011; 0049 |

## 3. Options at a high level

Each option is a level, not a mechanism. They stack: B includes A, C includes B's reasons, D includes C's costs.

| Option | Who holds the key | Hides payloads from | Does not hide them from | Costs |
| --- | --- | --- | --- | --- |
| **A. Encryption at rest, host-managed key.** Disk, backup and dump encrypted with keys the hosting operator holds. | The hosting operator | A stolen disk, backup or dump (F6 unchanged) | The host, the maintainer, a scoping bug, the running service | Small: infra only, no product change. Does not change the trust page's sentence |
| **B. Per-fleet key in the company's KMS** (L5, L6). Core encrypts payloads per fleet with data keys that the company's own KMS wraps; core asks it to unwrap. | The company, in its KMS; core uses it while allowed | Copies and backups; another tenant (a different key per fleet); a host who has no live access; and it gives the company a kill switch and a log of every use | The running service: whoever controls core while the company's key is reachable, the maintainer included | Medium. A KMS on the send and receive path (an outage stops them, so F1 refuses, never loses); per-fleet setup; the company needs a KMS. Every feature keeps working: gateway, Slack, console, plugins. Self-hosted fleets gain little |
| **C. A fleet key the hosting cannot read.** Payloads encrypted and decrypted only by parts the company runs (its trierarchs, its gateway, its ships' clients); core stores ciphertext and never holds the key. | The company's own parts | Copies, other tenants, the host and the maintainer (up to F15) | Every ship in the fleet; whichever parts the company runs | High. Every end needs the key (F3, F11): chats with no shell cannot join; the hosted gateway, Slack, outside parties and the hosted console lose content unless the company runs its own gateway and console (F8, F9); key distribution, rotation for a leaver, recovery (F1); retries resend the same ciphertext (F2) |
| **D. End to end between ships** (L1, L2). Per-ship keys, group keys for types, labels and meetings; only the receiving ships can read. | Each ship's crew: trierarchs, person ships' apps | Everything in C, plus other ships in the same fleet, plus argo and `fleet:read` | The ships that receive | Highest. A ship's key must survive every crew change and computer (F3); types and later schedules have no recipient set at send (F4); meetings need MLS-style group state (L2); resend (F5), argo's fail-safe reading and the viewer stop working; L1 to L3's multi-device and recovery costs, in a fleet where crews come and go by design |

What stays readable in every option: the metadata in section 1, report notes and details, statements, meeting titles, and everything the receiving end and its model provider see.

## 4. Questions for Thomas

**Q1. Is the purpose right?**
Context: section 1 aims at the host, a copy, another tenant and the maintainer, for the company's admin, people and ships, and leaves out the ends, model providers and metadata.
Options: (a) agree as written; (b) also hide ships from each other inside the company (the purpose of option D); (c) narrow it to copies and other tenants only (option A or B).
Pick: (a). The trust page's sentence is about the host and the maintainer; that is what a regulated buyer reads. (b) is a separate want that costs F3 and F4, and (c) leaves the sentence as it is.

**Q2. Which threat matters for the first platform customers?**
Context: Doccle, Silverfin and Qover will run a vendor assessment (L11). The questions there are "can your staff read our data" and "can we cut you off".
Options: (a) a copy of the data and other tenants; (b) the hosting operator and the maintainer; (c) other ships and people inside their own company.
Pick: (b), with (a) as the floor. It is the threat the trust page names. (c) is handled today by network rules and read reach (0034) and is the company's own choice.

**Q3. Do hosted and self-hosted differ?**
Context: a self-hosted company is its own host (F14); only copies and scoping bugs remain for it. Hosted Aeolus runs core, the console and the plugins at pagasae.
Options: (a) one mechanism for both, turned on per fleet; (b) hosted only; (c) no encryption feature: the strictest customers self-host, or run their own gateway and console beside hosted core.
Pick: (a). One mechanism keeps one test surface and one trust story; hosted is the reason for it, and self-hosted gets copy protection for free. (c) stays the answer for a customer who will not trust any code Thomas publishes (F15).

**Q4. What happens to the gateway's Slack, MCP and A2A features?**
Context: the gateway is an end for person ships and outside parties (F8). Slack, an outside MCP server and an A2A agent hold the content once it reaches them, whatever Aeolus does.
Options: (a) the gateway stays an end the company trusts: in hosted Aeolus it reads what reaches the ships it crews, and the console and discovery say so per ship, as WhatsApp marks a hosted business (L4); (b) a fleet that seals payloads runs its own gateway, so only the company's parts read; (c) sealed messages may not reach a gateway-crewed ship at all.
Pick: (a), with (b) open to a company that asks. Slack and outside servers read the content anyway, so sealing it from the gateway alone gains little, and (c) takes away people and outside parties, the reason the company connects at all.

**Q5. Key recovery: who gets the key back when every crew lost it?**
Context: a lost key is a lost message, against F1. Signal accepts loss (L1); Matrix and WhatsApp add a backup behind a recovery key (L3, L4); Proton and Tresorit give the business admin recovery (L8, L9); KMS makes recovery the customer's KMS's job (L6).
Options: (a) no recovery; (b) a company recovery key the organisation admin keeps offline; (c) the root key in the company's own KMS or HSM; (d) Aeolus holds an escrow copy.
Pick: (c), with (b) for a company without a KMS. The company recovers without Aeolus, which keeps the maintainer out; (a) breaks "never lost" and (d) breaks the purpose.

**Q6. Which level to design first?**
Context: section 3. B keeps every feature and answers copies, tenants and the kill switch, but the running service still reads. C keeps the host out but costs the hosted gateway, console and chat crews (F8, F9, F11). D costs the fail-safe and type sends (F4, F9).
Options: (a) B now, then C for fleets that turn it on; (b) C directly; (c) A only, and change the trust page's words; (d) D.
Pick: (a). B can be true by the demo's follow-up and lets the trust page say "your key, your kill switch, your log"; C then answers "the host cannot read" for the fleets that accept its costs. Neither (b) nor (d) fits before the demo, and (c) changes no answer a buyer asks.

**Q7. May argo and the console read a sealed fleet's payloads?**
Context: argo is the fail-safe and the operator inbox renders payloads on the console's server (F9, 0033). Under C, a hosted console cannot render what it cannot decrypt.
Options: (a) the console shows a sealed payload as sealed, and argo reads it through a part the company runs; (b) decrypt in the browser, an exception to 0033, with L10's weakness; (c) messages to argo are never sealed.
Pick: (a). It keeps 0033 and L10 out of the trust story. Most of what reaches argo comes from plugin ships and carries no client data; (c) would be a hidden rule a sender cannot see.

**Q8. Chat crews and REST-only ships in a sealed fleet?**
Context: a chat with no shell cannot hold a key (F11).
Options: (a) a ship whose crew cannot hold a key cannot receive or send sealed messages, and the console says so on the ship; (b) core decrypts for it, which makes core an end again; (c) no chat crews in a sealed fleet at all.
Pick: (a). It is true to what the ship is (blueprint, Principles), refuses at the send rather than storing what no one can read (F1), and keeps chats for everything else.

**Q9. Payloads only, or also report notes, statements and meeting titles?**
Context: these are stored readable beside the payload and are read by discovery and the plugins (section 1).
Options: (a) payloads only, and the docs say what else stays readable, so a crew keeps client data out of notes and titles; (b) seal notes and titles too; (c) seal statements as well.
Pick: (a). Statements drive discovery and the gateway's tools; notes and titles are short and chosen by the crew. Sealing them costs features for little.

**Q10. The model provider.**
Context: an agent ship's session sends the payload to its model provider; no option changes that.
Options: (a) out of scope, stated on the trust page with a pointer to model governance (0063) for choosing provider and region; (b) a fleet setting that limits sealed messages to sessions on named providers.
Pick: (a). Which models a fleet allows is already 0063's rule, kept in the trierarch plugin; a second rule here would split it.
