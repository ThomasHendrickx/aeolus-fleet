# Accounts in the whole domain model of Aeolus

Design by designer-accounts, for Thomas. Thomas read phase 1 (`accounts.md`) and saw gaps behind its questions. Before he answers them, this places accounts in the whole high-level domain model:

1. today's model across every component, one block per concept;
2. the whole in the domain language (decision 0050): one overview and four flows of how organisation, accounts, fleets, ships of every kind, plugins, the gateway and outside parties act together;
3. the gaps: every place where the model has no answer or two answers, each tied to the questions of `accounts.md` it touches.

**Thomas decided (19 Oct): organisation is a concept Aeolus needs.**

1. Organisation is a concept of its own, in the domain model.
2. Organisation management (its humans, their accounts, who administers what, which fleets it has) works on its own, without the gateway and without an outside identity provider.
3. Entra and Google are outside management that plugs in later (the organisation connects its directory), not the foundation.
4. So, before Google sign-in is ready, people sign in at the gateway with the organisation's own accounts.

**And where it lives (Thomas, 19 Oct):** "an organisation manages the user accounts within the whole. Pagasae is the account management unit." The organisation and its accounts live in pagasae, signing in by email as pagasae's sign-in links already do; the gateway signs people in through those accounts until an outside directory is connected; core keeps ships, scopes and owners.

Today "organisation" is only prose: the principle "one organisation, one fleet, many actors" (blueprint Principles, 0043) and "Organisation rules belong to the organisation" (blueprint Purpose). The fleet stands in for it (0007: the fleet is the tenant). Part 1 shows what stands in; part 2 places it; part 3 marks what it answers.

Read from main of each repository on 19 Oct 2026: aeolus-fleet `0e2168ce`, aeolus-fleet-gateway `916d431`, aeolus-fleet-squadrons `870f745`, aeolus-fleet-networking-plugin `58365ca`, aeolus-fleet-trierarch-plugin `7eece35`, pagasae `2ea340a`. Paths below are in aeolus-fleet unless a repository is named. Names are the blueprint's and the code's; where the code's table name differs from the blueprint's word, the table says both.

## 1. Today

### 1.1 The components

| Component | What it is | Its own store |
| --- | --- | --- |
| core | The fleet server, its API and argo's console (0043). Every fleet's ships, messages, scopes, labels and rules | `packages/core/src/adapters/prisma/schema.prisma` |
| squadrons | A plugin: a ship of each fleet it serves, its own process and database (0017, 0021) | aeolus-fleet-squadrons, `packages/squadrons/src/adapters/prisma/schema.prisma` |
| networking plugin | A plugin: the fleet's one rule setter (0035, 0036) | aeolus-fleet-networking-plugin, `packages/networking-plugin/src/adapters/prisma/schema.prisma` |
| trierarch plugin | A plugin: brings machines in and assigns crew requests (0030) | aeolus-fleet-trierarch-plugin, `packages/trierarch-plugin/src/adapters/prisma/schema.prisma` |
| trierarch | A process per machine, crewing a ship of type trierarch and the sessions it starts (0026) | aeolus-fleet-trierarch; its state on the machine |
| gateway | Outside MCP servers and clients as proxy ships; OAuth server; the fleet's identity provider (interop; 0048) | aeolus-fleet-gateway, `src/adapters/prisma/schema.prisma` |
| pagasae | The account app for hosted Aeolus: sign-up, one fleet per account, the owner's pages (0020) | pagasae, `prisma/schema.prisma` |

### 1.2 Diagrams: today

One overview of the components and their main concepts, then one diagram per area. Relations across components are by id only: no component reads another's store (0017, gateway schema header). In the area diagrams a box drawn inside a component's frame lives there; a box outside every frame is core's unless it says otherwise.

#### Overview

```mermaid
flowchart LR
  subgraph PAG["pagasae (hosted only)"]
    PA["pagasae account<br/>one email, one fleet"]
    PO["pagasae's owner<br/>OWNER_EMAIL setting"]
  end
  ORG(["organisation<br/>prose only, no record"])
  subgraph CORE["core"]
    INST["installation<br/>hosts fleets"]
    FLEET["fleet<br/>the tenant"]
    OPA["operator account"]
    CS["console session"]
    SHIP["ship<br/>argo, viewer, agent, person, app"]
    LEASE["lease<br/>the crew"]
    ACC["scope, network rule, label, owner<br/>access"]
    MSG["message and delivery"]
  end
  subgraph PLUG["plugins, each a ship of the fleet"]
    SQ["squadrons<br/>squadron, member"]
    NP["networking plugin<br/>argo's rules"]
    TP["trierarch plugin<br/>assigns crew requests"]
  end
  TRI["trierarch<br/>one per machine, starts sessions"]
  subgraph GW["gateway"]
    PARTY["party<br/>an outside MCP server or client"]
    IDP["identity provider<br/>one per fleet"]
    EP["fleet endpoint<br/>/fleets/alias/mcp"]
  end

  PO -->|drives with the installation token| INST
  PA -->|names| FLEET
  PA -.->|stands in for| ORG
  FLEET -.->|stands in for| ORG
  INST -->|hosts many| FLEET
  FLEET --> OPA
  OPA -->|one live| CS
  CS -->|crews argo or the viewer| SHIP
  FLEET -->|has many| SHIP
  SHIP -->|0 or 1| LEASE
  SHIP --- ACC
  SHIP -->|sends| MSG
  MSG -->|delivered to| SHIP
  SQ & NP & TP -->|crew their own ship| SHIP
  NP -->|supplies rules| ACC
  TRI -->|crews sessions of| LEASE
  TP -->|assigns ships to| TRI
  PARTY -->|one app proxy ship| SHIP
  IDP -.->|stands in for its directory| ORG
  EP -->|one per| FLEET
```

#### Fleet and ships

Ships and their kinds, who crews them, and what they send.

```mermaid
classDiagram
direction LR
class Fleet {
  name
  limits
}
class Ship {
  name, type
  kind
}
class Argo {
  kind operator
  permanent, every scope
}
class ViewerShip {
  kind viewer
  fleet:read, receives nothing
}
class AgentShip {
  kind agent
  states a model
}
class PersonShip {
  kind person
  crewed by the person's app
}
class AppShip {
  kind app
  an application or outside party
}
class Credential {
  ship secret, hashed
  used only to register
}
class Lease {
  crew token hash
  location, harness
  report, statement
  waker
}
class CrewRequest {
  settings, version
  assignment, status
}
class ClearRequest {
  ship, repository
}
class Trierarch {
  trierarch component
  one machine
}
class AgentSession {
  trierarch component
  harness, model
}
class Message {
  selector ship or type
  content type, payload
  model, inReplyTo
}
class Delivery {
  state
  attempts, hand-over number
}
class Question {
  a content type, no table
}
class Event {
  every state change
}
Fleet "1" --> "*" Ship
Ship <|-- Argo
Ship <|-- ViewerShip
Ship <|-- AgentShip
Ship <|-- PersonShip
Ship <|-- AppShip
Ship "1" --> "0..1" Credential : valid secret
Ship "1" --> "0..1" Lease : current crew
Ship "1" --> "0..1" CrewRequest
CrewRequest "*" --> "0..1" Ship : assigned trierarch ship
ClearRequest "*" --> "1" Ship : trierarch ship
Trierarch "1" --> "1" Ship : its trierarch ship
Trierarch "1" --> "*" AgentSession : starts
AgentSession "1" --> "1" Lease : crews, token held by the trierarch
Ship "1" --> "*" Message : sends
Message "1" --> "*" Delivery
Delivery "*" --> "1" Ship : recipient
Delivery "*" --> "0..1" Lease : claimed by
Message <|-- Question
Question ..> Ship : to the owner's ship
Event "*" --> "1" Ship : actor
```

#### Access: scopes, rules, owners, labels

What a ship may do (scopes) and where (reach, from network rules over labels and owners).

```mermaid
classDiagram
direction LR
class Ship {
  scopes
  owner
}
class Scope {
  namespace:action
}
class ScopeNamespace {
  one per plugin ship
}
class Label {
  key
}
class LabelValue {
  value
}
class NetworkSettings {
  version
  registered networking plugin
  while unavailable
}
class BuiltInRule {
  argo, owner, answer: never off
  viewer read
  open send, read, manage
}
class NetworkRule {
  verb send, read or manage
  from selector, to selector
}
class DeclaredNetworkRules {
  on the ship's own labels
}
class PluginConnection {
  argo's Connect
  reads every ship
}
class ReachRefusal {
  argo reads only
}
class FleetNetwork {
  networking plugin component
  argo's rules
}
Ship "*" --> "*" Scope : holds
Ship "1" --> "0..1" ScopeNamespace : declares
ScopeNamespace "1" --> "*" Scope
Ship "*" --> "0..1" Ship : owner, a person ship or argo
Label "*" --> "1" Ship : the label's owner
Label "1" --> "*" LabelValue
Ship "*" --> "*" LabelValue : carries
NetworkSettings "1" --> "*" BuiltInRule
NetworkSettings "1" --> "*" NetworkRule
Ship "1" --> "0..1" DeclaredNetworkRules
FleetNetwork ..> NetworkRule : supplies, with the declared ones
NetworkRule ..> LabelValue : selects by
NetworkRule ..> Ship : selects by owner
Ship "1" --> "0..1" PluginConnection
ReachRefusal ..> Ship : sender, recipient
```

#### Humans and sign-in

Every way a human gets in today, and what stands in for the organisation.

```mermaid
classDiagram
direction TB
namespace pagasae {
  class PagasaeAccount {
    email unique
    fleet 0..1
  }
  class PagasaeSession
  class SignInLink {
    one use, mailed
  }
  class PagasaeOwner {
    OWNER_EMAIL setting
  }
}
namespace core {
  class Installation {
    installation token
  }
  class SignInTicket {
    as operator or viewer
    one use, 2 min
  }
  class OperatorAccount {
    email unique in installation
    password hash 0..1
  }
  class ConsoleSession {
    device
    lease 0..1
  }
  class Argo
  class ViewerShip
  class PersonShip {
    no sign-in: a crew token pasted
  }
  class Notice {
    audience by session kind
  }
  class Guide {
    audience by session kind
  }
}
namespace gateway {
  class IdentityProvider {
    issuer, client id
    one per fleet, no people
  }
  class OAuthClient {
    an MCP client
  }
  class IssuedToken {
    names its party
  }
}
class Organisation {
  <<implicit>>
  no record
}
PagasaeAccount "1" --> "*" PagasaeSession
PagasaeAccount "1" --> "*" SignInLink
PagasaeOwner ..> Installation : drives
PagasaeAccount ..> SignInTicket : asks one
SignInTicket ..> ConsoleSession : starts
OperatorAccount "1" --> "0..1" ConsoleSession : one live
ConsoleSession "*" --> "1" Argo : one, holds the lease
ConsoleSession "*" --> "1" ViewerShip : many, no lease
Notice ..> ConsoleSession
Guide ..> ConsoleSession
OAuthClient "1" --> "*" IssuedToken
IssuedToken ..> ConsoleSession : argo approved at /authorize
PagasaeAccount ..> Organisation : stands in for
OperatorAccount ..> Organisation : its one human
IdentityProvider ..> Organisation : its directory
```

#### Plugins and the gateway

Each plugin is a ship of the fleet it serves, with its own store.

```mermaid
classDiagram
direction LR
namespace core {
  class Ship
  class AppShip
  class PluginConnection {
    argo's Connect
  }
  class ScopeNamespace
  class CrewRequest
}
namespace squadrons {
  class SquadronsConnection {
    ManagementCrew: crew token per fleet
    switch per fleet
  }
  class Squadron {
    forming ship, flagship
  }
  class Member {
    role
  }
  class TemplateRepository {
    templates and their roles
  }
}
namespace networking_plugin {
  class NetworkingConnection {
    crew token, switch per fleet
  }
  class FleetNetwork {
    argo's rules
  }
}
namespace trierarch_plugin {
  class TrierarchPluginConnection {
    crew token, switch per fleet
  }
}
namespace gateway {
  class GatewayConnection {
    crew token, switch per fleet
  }
  class Party {
    mcp-server or mcp-client
    owner ship
  }
  class ToolMark {
    argo's repeatable mark
  }
  class OAuthClient
  class IssuedToken
  class FleetEndpoint {
    /fleets/alias/mcp
  }
  class IdentityProvider {
    one per fleet
  }
  class Call {
    MCP out, by delivery
  }
  class ClientCall {
    MCP in, by message
  }
}
SquadronsConnection --> Ship : crews the plugin's ship
NetworkingConnection --> Ship
TrierarchPluginConnection --> Ship
GatewayConnection --> Ship
Ship "1" --> "0..1" PluginConnection : argo's Connect
Ship "1" --> "0..1" ScopeNamespace : squadrons declares one
Squadron "*" --> "1" Ship : forming ship
Squadron "1" --> "*" Member
Member "1" --> "1" Ship
TemplateRepository ..> Squadron : forms from
TrierarchPluginConnection ..> CrewRequest : assigns
Party "1" --> "1" AppShip : proxy ship
Party "*" --> "1" Ship : owner, kept again
Party "1" --> "*" ToolMark
Party "1" --> "0..1" OAuthClient
OAuthClient "1" --> "*" IssuedToken
IssuedToken "*" --> "1" FleetEndpoint
Party "1" --> "*" Call
Party "1" --> "*" ClientCall
```

### 1.3 The concepts

| Concept | Lives in | What it is | Grounded in |
| --- | --- | --- | --- |
| Organisation | nowhere (prose) | Implicit. Stood in for by the fleet (the tenant), the pagasae account (one account, one fleet), the operator account (the fleet's one human) and the gateway's identity provider (the organisation's directory, kept per fleet) | blueprint Principles and Purpose, 0007, 0043; no table in any store |
| Installation | core | One server and the fleets it hosts; driven by a hosting service with the installation token; limits and the fleet cap | 0020; `InstallationSettings`, `InstallationRequest` |
| Sign-in ticket | core | One use, 2 minutes, signs in as the operator or the viewer | 0020, 0022; `SignInTicket`, `SignInAs` |
| Notice, guide | core | The installation's text and steps for console sessions of an audience: everyone, operators or viewers | 0023, 0024; `Notice`, `Guide`, `NoticeAudience` |
| pagasae account | pagasae | One email, signed in by email link, at most one fleet, whose operator it is; deletes its fleet with it | pagasae `prisma/schema.prisma` `Account`; `app/account/page.tsx` |
| pagasae session, sign-in link | pagasae | A signed-in browser; a mailed one-use link | pagasae `Session`, `SignInLink` |
| pagasae's owner | pagasae | The person who runs the hosting service, by the `OWNER_EMAIL` setting; sees and deletes every fleet | pagasae `lib/guards.ts` `requireOwner`, `lib/config.ts` |
| Fleet | core | The tenant; every record has `fleet_id` | 0007; `Fleet` |
| Operator account | core | The one human account of a fleet: email (unique in the installation), password hash (none when hosted), theme | 0012, 0020; `Operator` (`opr_`) |
| Console session | core | A browser signed in: argo's (one live, holding argo's lease) or a viewer's (many, no lease) | 0012, 0022; `ConsoleSession` (`ses_`) |
| Ship | core | A durable identity with an inbox: name, type, kind, scopes, owner | blueprint language; `Ship` |
| argo | core | The ship of kind operator: permanent, every scope, crewed only by the operator's console session | 0012; `ShipKind.operator` |
| The viewer | core | The ship of kind viewer: `fleet:read`, receives nothing, crewed by viewer sessions | 0022; `ShipKind.viewer` |
| Agent, person, app ship | core | The other kinds: an agent states a model; a person's app holds a person ship's lease; an app is an application or outside party. Plugin and trierarch ships are agents today | 0044, 0018; `ShipKind`; commission's kind defaults to agent (`packages/common/src/schemas/fleet.ts`) |
| Owner | core | A ship's one owner, a person ship or argo; a relation, not a record | 0045; `Ship.ownerShipId` |
| Ship secret | core | One valid at a time, used only to register | 0002; `Credential` (`crd_`) |
| Lease, crew | core | One session's right to crew a ship: crew token hash, location, harness, report, statement, who wakes it | 0010, 0015, 0028, 0040, 0047; `Lease` (`lse_`), `LeaseWaker` |
| Scope | core | `<namespace>:<action>` on the ship, on the server | 0046; `Ship.scopes` |
| Scope namespace | core | One plugin's declared namespace and scopes | 0046; `ScopeNamespace` |
| Label, label value | core | A key owned by the ship that defined it, values carried by ships | 0031; `Label`, `LabelValue`, `ShipLabel` |
| Crew request, clear request | core | Declared crew state on a ship; a trierarch's worktree to clear | 0029, 0032; `CrewRequest`, `WorktreeClearRequest` |
| Network settings | core | A fleet's rules, the built-ins' switches, the registered networking plugin, a version | 0034, 0035; `NetworkSettings` |
| Built-in rule | core | argo, the owner and an answer, never off; the viewer read; open per verb | 0034; `NetworkSettings.builtIn*` |
| Network rule | core (stored), networking plugin (set) | A verb from one selector to another, by labels or owner | 0034, 0036; `NetworkSettings.rules`, networking plugin `FleetNetwork` |
| Declared network rules | core | A label owner's own rules, supplied by the networking plugin | 0037; `DeclaredNetworkRules` |
| Plugin connection | core | argo's Connect: the plugin's ship reads every ship | 0034; `PluginConnection` |
| Reach refusal | core | A refused send's record, argo's only | 0034; `ReachRefusal` (`rfs_`) |
| Message, delivery | core | The envelope and one delivery per recipient | 0001, 0040; `Message`, `Delivery` |
| Question | core (a convention) | A message of `application/vnd.aeolus.question+json` to the owner's ship; no table | 0038 |
| Event | core | Every state change, with its actor ship | architecture; `Event` |
| A plugin's connection | each plugin | The plugin's ship's crew token per fleet, and its switch per fleet | 0017, 0021; squadrons `ManagementCrew`, `FleetSwitch`; networking plugin and trierarch plugin `Connection`, `FleetSwitch`; gateway `Connection`, `FleetSwitch` |
| Squadron, member, template | squadrons | A squadron formed from a template, its forming ship and flagship; each member a ship with a role | 0017; squadrons `Squadron`, `Member`, `TemplateRepository` |
| argo's network | networking plugin | The rules argo edits, and what holds while unavailable | 0036; `FleetNetwork` |
| Trierarch, agent session | trierarch | A machine's process and the sessions it starts, holding their crew tokens | 0026, 0039 |
| Party | gateway | An outside MCP server or client argo approved, with its app proxy ship and its owner | interop I-5; gateway `Party` |
| OAuth client, issued token | gateway | A pre-registered MCP client; an access and refresh pair naming a party, bound to one fleet endpoint | gateway `OAuthClient`, `IssuedToken`, `AuthorizationCode` |
| Fleet endpoint | gateway | Each fleet's own MCP URL, `/fleets/<alias>/mcp` | gateway `src/adapters/crypto/fleet-endpoints.ts`, commit `916d431` |
| Identity provider | gateway | The fleet's company IdP: issuer, client id and secret; set by argo; nothing signs in with it yet | interop I-4; gateway `IdentityProvider`, commits `4c0e685`, `f759919` |
| Tool mark | gateway | argo's repeatable mark on a tool | interop 5.2; gateway `ToolMark` |

The gateway's sign-in today is for MCP clients only: argo approves each client at `/authorize`, signed in to the console; the gateway checks the console session holds `fleet:manage`, which only argo's does (gateway `src/adapters/http/oauth-routes.ts`). No person signs in through the gateway yet.

## 2. The whole, in the domain language

Every word below is a term of the blueprint's [Domain language](../../blueprint.md#domain-language) (decision 0050, PR in review). Parts marked "to build" do not exist yet; where the answers to `accounts.md` will place them, the diagram follows its picks.

### 2.1 Overview

Each arrow is labelled with what one part does to the other.

```mermaid
flowchart TB
  human["Human"]

  subgraph pagasae["pagasae"]
    direction LR
    admin["Installation admin"]
    org["Organisation<br/>(to build)"]
    acc["Account"]
    orgadmin["Organisation admin<br/>(an account, to build)"]
    dir["Directory<br/>(to build)"]
    idp["Identity provider<br/>(to build)"]
    idn["Identity"]
  end

  subgraph core["core"]
    direction LR
    inst["Installation"]
    subgraph fleet["Fleet"]
      direction LR
      argo["argo<br/>kind operator"]
      viewer["viewer<br/>kind viewer"]
      person["Person ship<br/>kind person"]
      agent["Agent ship<br/>kind agent"]
      app["App ship<br/>kind app"]
      plug["Plugin ship<br/>kind plugin"]
      scope["Scope"]
      rule["Network rule<br/>and built-in rule"]
      label["Label"]
    end
  end

  subgraph plugins["Plugins: one install, many fleets"]
    direction LR
    sq["squadrons"]
    np["Networking plugin"]
    tp["Trierarch plugin"]
    gw["Gateway"]
  end

  trier["Trierarch<br/>(an app ship's crew)"]
  party["Outside party"]

  human -- signs in with --> acc
  human -- "signs in as (viewer ticket)" --> viewer
  admin -- runs --> inst
  org -- holds --> acc
  org -- holds --> dir
  dir -- reads --> idp
  idp -- holds --> idn
  idn -- signs in --> acc
  org -- holds --> fleet
  orgadmin -- links an account to --> person
  acc -- signs in as --> argo
  acc -- linked to --> person

  inst -- hosts --> fleet
  argo -- connects --> plug
  argo -- commissions --> person
  argo -- approves --> party
  person -- owns --> agent
  scope -- granted to --> person
  rule -- lets reach --> agent
  plug -- defines --> label

  plugins -- crews --> plug
  np -- sets --> rule
  sq -- commissions --> agent
  tp -- "assigns crew requests to" --> trier
  trier -- crews --> app
  trier -- crews --> agent

  gw -- signs people in through --> acc
  gw -- crews --> person
  gw -- "commissions and crews (proxy ship)" --> app
  party -- calls --> gw
```

Read it as:

- **Humans.** A human signs in with their account, held by the organisation in pagasae, by email or later with an identity from the organisation's identity provider. The operator is the human whose account signs in as argo; a human with a viewer ticket signs in as the viewer.
- **People in a fleet.** An organisation admin links an account to a person ship, which argo commissions. The person ship's scopes are that human's rights in the fleet; network rules say where they reach. A person ship owns ships, such as its agents.
- **Plugins.** The installation admin installs a plugin once; argo connects it to each fleet, and that commissions its plugin ship, which reads every ship by a built-in rule. The plugin crews its own plugin ship.
- **Crew.** The trierarch plugin assigns crew requests to trierarchs; a trierarch crews its own app ship and the agent ships it starts. squadrons commissions the agent ships of a squadron.
- **The gateway.** It signs people in through their accounts and crews their person ships; argo approves an outside party and the gateway commissions its proxy ship, an app ship it crews for that party.

### 2.2 A human signs in at the gateway and reaches their ship

```mermaid
sequenceDiagram
  actor H as Human
  participant GW as Gateway
  participant P as pagasae
  participant C as core (fleet)
  H->>GW: open the gateway
  GW->>P: gateway sign-in
  alt by email
    P-->>H: sign-in link
    H->>P: open the sign-in link
  else identity provider connected (to build)
    P->>H: sign in at the identity provider
    H-->>P: identity
  end
  P-->>GW: the account, its organisation, its fleets and the person ship linked in each
  alt no person ship linked in any fleet
    GW-->>H: refused: ask an organisation admin
  else one or more fleets
    H->>GW: pick a fleet (straight in when there is one)
    GW->>C: crew the person ship (hold its lease)
    H->>GW: send, read, answer a question
    GW->>C: the call as the person ship
    C->>C: scope says what, reach says where
    alt allowed
      C-->>GW: OK once stored
      GW-->>H: done
    else refused
      C-->>GW: refused, without reasons
      GW-->>H: refused
    end
  end
```

### 2.3 argo connects a plugin to a fleet

```mermaid
sequenceDiagram
  actor IA as Installation admin
  actor O as Operator
  participant A as argo (console)
  participant C as core (fleet)
  participant PL as Plugin
  IA->>PL: install once, switch on for the fleet
  O->>A: console sign-in as argo
  A->>PL: Connect
  alt plugin switched off for the fleet
    PL-->>A: refused
  else switched on
    A->>C: commission the plugin ship (kind plugin), owner argo
    C-->>A: ship secret, once
    A->>PL: ship secret
    PL->>C: register
    C-->>PL: crew token
    PL->>PL: keep the connection (ship and crew token)
    PL->>C: declare its scope namespace
    C->>C: built-in rule: kind plugin reads every ship
    PL-->>A: connected
  end
  Note over C,PL: a release or retire of the plugin ship ends the connection and its read
```

### 2.4 An organisation admin links a new person

```mermaid
sequenceDiagram
  actor OA as Organisation admin
  participant P as pagasae
  actor H as New human
  participant A as argo
  participant C as core (fleet)
  OA->>P: add an account (email) to the organisation
  P-->>H: sign-in link
  OA->>P: link the account to a person ship in a fleet
  alt the account already has a person ship in that fleet
    P-->>OA: refused: one person ship per fleet
  else none yet
    P->>A: ask argo to commission the person ship
    A->>C: commission the person ship, its scopes, owner argo
    C-->>A: the person ship
    A-->>P: the person ship
    P->>P: link the account to the person ship
    P-->>OA: linked
  end
  Note over P,C: who commissions the person ship (argo alone, or an organisation admin through a grant) is a question of accounts.md
```

### 2.5 An outside party is approved and called

```mermaid
sequenceDiagram
  participant OP as Outside party
  participant GW as Gateway
  actor O as Operator
  participant C as core (fleet)
  participant S as A ship
  OP->>GW: ask to reach the fleet
  GW->>O: approve this outside party?
  alt refused
    O-->>GW: no
    GW-->>OP: refused
  else approved
    O-->>GW: approve, owner a person ship or argo, its scopes
    GW->>C: commission the proxy ship (kind app), its owner and scopes
    GW->>C: crew the proxy ship
    GW-->>OP: approved
  end
  OP->>GW: call a capability of a ship
  GW->>C: send as the proxy ship
  alt reach refuses
    C-->>GW: refused, without reasons
    GW-->>OP: refused
  else stored
    C-->>GW: OK
    C->>S: delivery
    alt answered within the capability's deadline
      S->>C: ack, then the answer
      C->>GW: delivery of the answer
      GW-->>OP: the answer
    else deadline passed
      GW-->>OP: no answer yet
    end
  end
```

## 3. Gaps

Each gap is a place where the model has no answer or two answers. "Organisation" says whether Thomas's decisions of 19 Oct (organisation, and pagasae as its home) answer or narrow it. "Questions" names the questions of the revised list in `accounts.md` (1 to 25) that take it up; every gap has at least one.

| # | Gap | No answer or two answers | Organisation | Questions |
| --- | --- | --- | --- | --- |
| G1 | **What a human is.** A human appears as five unrelated things: an operator account (email), a pagasae account (email), pagasae's owner (a setting), a person ship (no identity at all), and a viewer session (anonymous). Nothing links them, and 0045 left "a person record beside the person's ship" out | No answer | Answers: a human is an account of the organisation | 1, 4, 14 |
| G2 | **"Account" is taken three times.** The operator account (core), the pagasae account (pagasae), and the company Google or Microsoft account people sign in with; `console.account` also answers a viewer's session, which has no account | Two answers, three meanings | Narrows: one account, the organisation's; the operator and pagasae accounts fold in | 13, 16, 20 |
| G3 | **"Owner" is taken three times.** A ship's owner (0045), a label's owner (0031: the ship that defined it, with rights to assign it), and pagasae's owner (the hosting service's runner). The first two are both ships but mean different things: answering for a ship, and holding rights over a label | Two answers, three meanings | No | 20 |
| G4 | **"Role" is already taken.** A squadron member has a role, from its template (squadrons `Member`, 0017). Thomas's "roles" for humans would be a second meaning; 0046 rejected roles as a scope bundle | Two answers | Narrows: a role may be the organisation's, a fleet keeps scopes | 4, 6 |
| G5 | **"Session" is taken three times.** The agent run crewing a ship (blueprint), the console session (core, `ses_`), and pagasae's session. A gateway sign-in will add a fourth | Two answers | No | 20 |
| G6 | **"Connection" and "connect" mean three things.** argo's Connect of a plugin in core (`PluginConnection`: the plugin reads every ship), each plugin's own connection (its ship's crew token, `Connection`, `ManagementCrew`), and phase 1's "connect a person" | Two answers | No | 7, 20 |
| G7 | **Rights that sit on a session, not on a ship.** The operator's way in is an account and a console session; the notices and the guide pick their audience by session kind (`operators`, `viewers`), not by scope; the gateway decides "argo approves" by the console session's `fleet:manage`, which works only because no other human has a console session; squadrons serves writes to the operator's session alone | Two answers: scopes and session kind | Narrows: argo's console session belongs to an account | 1, 5, 13, 24 |
| G8 | **Rights outside any fleet, held by no ship.** The installation token (the hosting service), pagasae's owner (by email setting) and the pagasae account (deletes its fleet through the installation) act on fleets without being a ship. 0020 allows the hosting service as the one non-ship caller; the account and owner ride on it | Rights outside the model | Answers: organisation rights are pagasae's, beside the installation token pagasae already holds | 2, 4 |
| G9 | **One human, several ships, unseen.** Several humans can share argo's password; many humans share the one viewer ship; nothing tells them apart in the events, which name only the ship | No answer for "who did it" | Narrows: each account crews argo as itself | 5, 13 |
| G10 | **Things only argo can do.** Commission a person ship; change an owner; grant a plugin's scope; read refusals; explain reach; connect a plugin; edit the network (networking plugin); approve a party, register an OAuth client, set the identity provider and mark a tool (gateway); write in squadrons' pages; reset a password (a server command) | One holder for all of it | No | 5, 7 |
| G11 | **The party's owner is kept twice.** The gateway stores the owner argo picked on the party (`Party.ownerShipId`), and core stores the proxy ship's owner (`Ship.ownerShipId`). argo can change the second with `fleet.setOwner`; the first then disagrees | Two answers | No | 19 |
| G12 | **One address against one endpoint per fleet.** Thomas decided one gateway address for all fleets. The gateway serves one MCP endpoint per fleet, `/fleets/<alias>/mcp`, and binds every token to it (commit `916d431`, "one fleet URL", interop 1) | Two answers | Answers: sign in, find the organisation, then the fleet | 12 |
| G13 | **The identity provider has no people.** The gateway keeps one IdP per fleet (issuer, client id) but nothing that says which IdP subject is which person ship, nor which directory (tenant) the fleet is. I-4 says "by argo's mapping"; the mapping exists nowhere | No answer | Answers: the accounts are the organisation's; a directory signs them in later | 11, 17 |
| G14 | **A person's email lives in two places.** The pagasae account's email and the operator account's email are the same person, kept twice, in two stores; a change in one leaves the other | Two answers | Answers: one account, in pagasae | 16 |
| G15 | **Who approves an MCP client is argo, by a console session, in the gateway's page; who approves a person is nobody.** Clients get a party and an app proxy ship at `/authorize`; a person's MCP client has no path to a person ship, though the interop table lists that case (interop 3.2) | No answer | Narrows: a person is an account; their MCP client signs in as it | 7, 9, 11, 14 |
| G16 | **Plugin and trierarch ships are agents.** They are processes, not sessions with a model (squadrons states its package and version, 0018), yet their kind is agent because a commission defaults to it. "Be true to what a ship is" (0044) has no kind for them | No answer | No | 21 |
| G17 | **The machine's human.** A trierarch runs on a person's machine, and the trierarch plugin's placement is "across people's machines" (0030), but the trierarch ship is argo's and nothing names whose machine it is. Placement by person has no fact to select on | No answer | Narrows: a machine could name an account | 22 |
| G18 | **Where a person answers a question.** Questions go to the owner's ship (0038); argo answers in the console, whose questions UI is frozen (0043). A person ship's crew is "their app or a chat" or the gateway, but no component today shows a person their questions | No answer | No | 24 |
| G19 | **The viewer is a ship, its humans are not.** Many viewer sessions crew one ship with no lease; a viewer is "anyone the hosting service hands a ticket". If a person needs a read-only look (J6), the viewer cannot tell them apart and reads every ship | Two answers for read-only: the viewer ship, or a person ship with `fleet:read` | Narrows: a person's read-only look is their person ship with `fleet:read` | 23 |
| G20 | **A leaver's ships.** When a person leaves, their person ship's owned ships fall to argo only once the person ship is retired (0045). Nothing says who retires it, and the IdP has no way to tell the fleet | No answer | Narrows: the organisation disables the account | 15 |
| G21 | **The first human of a fleet.** Self-hosted: a server command creates the operator account. Hosted: pagasae's sign-up creates it. With the gateway, the first person to sign in with the company account has no ship until someone connects them, and only argo can | No answer for who goes first | Answers: the organisation's first account, from pagasae's sign-up, hosted or self-hosted | 13, 16, 25 |
| G22 | **Outside people.** A supplier's employee has no place: outside parties are app ships, a person ship is the organisation's own | No answer | No | 18 |
| G23 | **Notices and the guide address operators and viewers only.** People signing in through the gateway are neither; their app shows its own (scope rework 0.6) | No answer | No | 24 |

New gaps, from organisation:

| # | Gap | No answer or two answers | Organisation | Questions |
| --- | --- | --- | --- | --- |
| G24 | **Organisation is prose only.** "One organisation, one fleet" (blueprint Principles, 0043) and "Organisation rules belong to the organisation" (blueprint Purpose) name it; no store holds it | No answer | Answers: in pagasae (Thomas's lead) | 2 |
| G25 | **Two tenants.** The fleet is the tenant: every record has `fleet_id` and lookups before the fleet is known are named exceptions (0007). An organisation above its fleets is a second boundary, and an account is found before any fleet is | Two answers | Answers: the organisation lives in pagasae, so core's tenant stays the fleet (0007) | 2, 3 |
| G26 | **The principle against several fleets.** "One organisation, one fleet, many actors" against an organisation that "has fleets" (Thomas's words of 19 Oct) | Two answers | Raised | 3 |
| G27 | **The directory sits in the gateway, per fleet.** The gateway keeps one identity provider per fleet (`IdentityProvider`); the organisation's directory belongs to the organisation and serves every fleet and the console, not only the gateway | Two answers | Answers: the directory moves to pagasae | 11, 17 |
| G28 | **The installation knows fleets, not organisations.** Fleet create names an operator email; limits and the fleet cap are per fleet and per installation (0020); notices address sessions. Who creates an organisation, and what is limited per organisation, has no place | No answer | Narrows: pagasae creates the fleets of an organisation through the installation; what is limited per organisation is pagasae's | 3, 16, 25 |
| G29 | **Rights on an account.** Managing the organisation (its accounts, its fleets, its directory) happens above every fleet, where no ship is, so these rights sit on the account. That is the one place rights would not be a ship's (0012: every caller is a ship) | Two answers: account and ship | Raised | 4 |
| G30 | **One human in two organisations.** A consultant works for two; Entra makes them a guest in the second. One account per organisation, or one human with accounts in several, has no answer | No answer | Raised | 18 |
| G31 | **pagasae is hosted only and private.** Its README opens "Private"; it serves one account, one fleet, and assumes a hosting service (terms, the demo, the owner's pages). A self-hosted fleet has its operator account in core and no pagasae, so organisation management (Thomas's point 2) has no home there | No answer | Raised by Thomas's lead | 25 |
