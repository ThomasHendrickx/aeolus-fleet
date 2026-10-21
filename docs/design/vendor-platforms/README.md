# Aeolus beside vendor agent platforms

Study for [#1021](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1021). It sets out the purpose, which Thomas agreed on 21 Oct 2026, what each platform is today, and the questions for Thomas. No code.

Platforms: Microsoft Agent 365 with Copilot Studio, Google Gemini Enterprise, Salesforce Agentforce with MuleSoft Agent Fabric, AWS Bedrock AgentCore. Facts as of 21 Oct 2026, from the sources at the end.

## 1. Purpose (agreed)

A company keeps its agents on Agent 365, Gemini Enterprise, Agentforce or AgentCore and adds Aeolus without moving any of them. Their agents reach fleet ships, and fleet ships reach them, through the gateway (0048) by MCP or A2A. Each of these agents is an outside party with a proxy ship and an owner. Network rules govern it as they govern any ship, and stored before OK covers its messages.

Outcomes:
1. A Copilot Studio agent sends work to a fleet ship. The ship's crew is down. The message waits and is delivered when a session crews the ship again.
2. A fleet ship calls an AgentCore agent. AgentCore restarts mid-call. The call is handed again, or reported not handled, as 0040 and interop I-7 say. It is never silently lost.
3. An admin points their platform's registry or agent builder at a fleet ship and lists it beside their own agents.
4. Discovery shows which outside parties were verified, and by what check (0059).

Not the purpose:
- Replacing a vendor's registry, identity, governance or observability.
- Orchestrating vendor agents. Agent Fabric's broker is an LLM router, and Aeolus is not an orchestrator.
- Running agents. Aeolus distributes; it does not execute (0001).

## 2. What is true today in Aeolus

- **Gateway** `@aeolus-fleet/gateway` v0.28.1 (21 Oct 2026). Built: MCP out (an outside MCP server as an app proxy ship) and MCP in (an outside MCP client signs in through pagasae, sees the capabilities of reachable ships as tools, and calls them with a bounded wait and a handle). Built too: approving, the outside parties switch and verified facts (`tlsHost`, `clientIdDocumentDomain`).
- **A2A in and out** is designed (interop, `design/interop`, slices 4 and 5) and open in [#878](https://github.com/ThomasHendrickx/aeolus-fleet/issues/878). The design has an agent card per alias, JSON-RPC and HTTP+JSON, and push webhooks.
- **Statements** borrow the field names of A2A's agent card and MCP's tool list (0047, 0048).
- **Verified facts** come from a closed list: `clientIdDocumentDomain`, `tlsHost`, `a2aCardDomain` and `oauthSubject` with issuer (0059).
- **Only a signed-in account of the fleet asks for an outside MCP client** (0056). An actor holding the approving scope adds an outside MCP server.

## 3. Lessons to check against

| Lesson | Source |
| --- | --- |
| Every caller is a ship: one proxy ship per outside party, never a shared one | 0044, 0056, interop |
| Policy stays in core; no rules of Aeolus's own, a warning at most | 0016, 0034, I-3 |
| A human answers for every ship: the owner is core's, a person ship or argo | 0045, 0056 |
| Speak the protocols, not only their formats; no task lifecycle in core | 0048 |
| What was checked stands apart from what was stated, from a closed list | 0059 |
| No synonyms. A vendor's "sponsor", "registry entry" or "agent identity" is named as theirs, never as an Aeolus term | 0050 |
| Minimal before 1.0: no paid-product polish for zero customers | 0013, CLAUDE.md |

## 4. The platforms

### Microsoft Agent 365 with Copilot Studio
- **Today:** GA on 1 May 2026, USD 15 per user per month [M1]. It holds a registry of agents with owners and risk signals, identity through Entra Agent ID, data protection through Purview, and Defender [M2]. Syncing registries with Bedrock and Vertex is in preview [M1].
- **Joining a fleet:**
  - **Reaching fleet ships:** Copilot Studio calls outside A2A agents by URL and reads the card at `/.well-known/agent.json`, the path from before A2A 0.3. It authenticates with none, an API key or OAuth [M3]. It also takes MCP tools [M4], so it can reach the gateway's MCP in, which is built.
  - **Being reached:** a Copilot Studio agent cannot serve A2A itself; only third-party gateways expose one [M3].
  - **Listing a fleet ship:** the registry takes the Agent 365 SDK (an Entra agent identity blueprint), a manifest upload, or a partner integration. It takes no A2A card or MCP entry [M5].
- **Identity:** every agent identity comes from a blueprint. A sponsor (a business person) is required; an owner (technical) is optional [M6]. Third-party agents use workload identity federation [M7].
- **Delivery:** request and response, and notifications pushed over the Activity schema. Nothing is documented on retries or queues [M8].

### Google Gemini Enterprise
- **Today:** it replaced Agentspace on 9 Oct 2025 [G1]. At Next '26 it became the Gemini Enterprise Agent Platform: Agent Runtime, Agent Identity, Agent Registry, and an Agent Gateway that denies by default, governed by IAM [G2, G3].
- **Joining a fleet:**
  - **Reaching fleet ships:** an admin pastes an outside agent's A2A card (0.3 streaming; 1.0 through SDK compatibility packages), in preview [G4]. Bring your own MCP server takes Streamable HTTP only [G5].
  - **Being reached:** the API lists A2A methods; whether outside clients may call them is unconfirmed [G6].
  - **Listing a fleet ship:** the Agent Registry registers an outside agent as `A2A_AGENT_CARD` by API, gcloud or Terraform [G7]. Marketplace listing goes through Google's partner review [G8].
- **Identity:** a SPIFFE ID and an mTLS-bound certificate per agent, only for agents in Google's own runtimes [G9]. The creator owns an agent. Admins may switch on review [G10].
- **Delivery:** A2A as the spec defines it. Messages "MUST NOT be considered a reliable delivery mechanism", and push is attempted at least once, with retries optional [G11].

### Salesforce Agentforce with MuleSoft Agent Fabric
- **Today:** Agentforce 360 went GA in Oct 2025 [S1]. Agent Fabric (Exchange as registry, broker, gateway policies, Agent Visualizer) shipped on 3 Oct 2025 and moved to A2A 1.0 in Jul 2026 [S2].
- **Joining a fleet:**
  - **Reaching fleet ships:** Agentforce has an MCP client [S3].
  - **Being reached:** Salesforce says Agentforce works A2A in both directions, with no status given [S4]. Its Hosted MCP Servers have been GA since Summer '26 [S5].
  - **Listing a fleet ship:** Agent Fabric registers agents from their A2A card or from a YAML declaration [S6]. It adds remote MCP servers by URL, including OAuth 2.1 with PKCE [S2, S7]. Its scanners find agents on Bedrock, Vertex and Copilot Studio [S2]. It bridges non-A2A agents by deriving a card [S8].
- **Identity:** an asset has an owner and belongs to an Anypoint business group [S6]. Trusted Agent Identity exchanges tokens through Okta or Entra (seen in snippets only, unverified).
- **Delivery:** the broker allows a 60 s task timeout and 3 retries by default. The example card sets `pushNotifications: false`. No queueing is documented [S9].

### AWS Bedrock AgentCore
- **Today:** GA on 13 Oct 2025 [A1]. Its parts are Runtime, Gateway, Identity, Memory, Observability, Policy and Evaluations. AWS Agent Registry went GA on 31 Aug 2026 [A2].
- **Joining a fleet:**
  - **Reaching fleet ships:** Gateway puts existing MCP servers behind it as tools, and since Jul 2026 it passes outside A2A agents and MCP servers through unchanged [A2].
  - **Being reached:** Runtime hosts A2A servers with the card at `/.well-known/agent-card.json` [A3].
  - **Listing a fleet ship:** the Agent Registry takes AGENT records, checked against the A2A card schema, and MCP records. It syncs them from outside endpoints. A curator approves each one, manually or by auto-approve [A4]. Marketplace has listed A2A servers since Nov 2025 [A5].
- **Identity:** every agent is a workload identity with an ARN, wherever it runs. A KMS token vault holds its credentials. It calls out with OAuth client credentials or with user consent. Calls in are signed with SigV4 or carry a JWT [A6].
- **Delivery:** sessions of request and response, ending after 15 minutes idle [A7]. AWS's own advice is SQS, SNS or EventBridge for durable messages between agents (seen through a search summary only) [A8].

### Comparison

| | Agent 365 / Copilot Studio | Gemini Enterprise | Agentforce / Agent Fabric | Bedrock AgentCore |
| --- | --- | --- | --- | --- |
| Status | GA May 2026 | GA Oct 2025, platform rename Apr 2026 | Agentforce GA Oct 2025, Agent Fabric Oct 2025 | GA Oct 2025, registry Aug 2026 |
| Its agents call outside agents (MCP) | Yes (Copilot Studio) | Yes, Streamable HTTP only | Yes | Yes (Gateway targets) |
| Its agents call outside agents (A2A) | Yes, card at the old path | Yes, 0.3 card pasted, preview | Yes, A2A 1.0 | Pass-through (Gateway) |
| Its agents serve A2A | No, gateways only | Unconfirmed | Stated, no status | Yes (Runtime) |
| Registry takes an outside agent | SDK, manifest or partner; no card | A2A card by API | A2A card, YAML, MCP URL | A2A card or MCP, synced, curator approves |
| Identity, owner | Entra Agent ID, sponsor required | SPIFFE, own runtimes only; creator owns | Business group owner | Workload identity ARN |
| Durable delivery between agents | None documented | None (A2A: not reliable) | None documented | None; AWS points to SQS |
| Overlaps Aeolus in | Inventory, owner, approval | Registry, gateway deny-by-default | Registry, routing between agents | Registry with approval, policy |

## 5. What this means for Aeolus

- **Where Aeolus adds something.** None of the four documents a durable delivery between agents. Every one is request and response, with best-effort push at most. The fleet's stored-before-OK promise, waiting while a crew is down, and 0040's once-more rule are what they lack. Aeolus also reaches agents none of them inventory, such as Claude Code and Codex sessions on people's computers through the trierarch.
- **Where it overlaps.** Each has a registry or inventory with owners, an approval step and a deny-by-default gateway or policy. The fleet snapshot, owners (0045), approving (0056) and network rules cover the same ground for the fleet. Two of them, Agent 365 and Agent Fabric, already sync each other's registries.
- **A2A out reaches three of the four, and A2A in all four.** A2A in reaches all four through each one's A2A client (pass-through for AgentCore). A2A out reaches AgentCore Runtime, Agent Fabric, and Gemini Enterprise if its methods turn out open to outside callers. The gateway's MCP in, built today, already reaches every one of their MCP clients.
- **Card versions differ.** Copilot Studio reads `/.well-known/agent.json` (before 0.3), Gemini Enterprise pastes 0.3 cards, and Agent Fabric and AgentCore use 1.0 at `/.well-known/agent-card.json`.
- **A machine client has no human at the authorize step.** AgentCore calls out with client credentials. 0056 lets only a signed-in account ask for an outside MCP client.
- **A vendor's identity is a fact, not an owner.** An Entra Agent ID, an AWS workload ARN or a Google SPIFFE ID can be `oauthSubject` with its issuer (0059). Entra's sponsor and Anypoint's business group owner are not Aeolus owners.

## 6. Questions for Thomas

Each question stands on its own: what it is about, numbered options, and my pick with why.

### V1 What Aeolus is to these platforms

The purpose (part 1) puts vendor agents in the fleet as outside parties. What is left open is what Aeolus offers beside the platforms. All four keep an inventory of agents with owners and an approval step. Agent 365 and Agent Fabric already sync each other's inventories and those of Bedrock and Vertex. None of the four documents delivery that survives a crew or agent being down.

1. **Delivery and one network.** Aeolus carries messages between vendor agents and fleet ships, stored before OK, under network rules. It keeps no inventory of the vendors' agents beyond the proxy ships of approved outside parties.
2. **Also an inventory across platforms.** Aeolus imports each vendor's inventory and shows every agent, approved or not.
3. **Nothing vendor-specific yet.** Finish level 3 in interop's order and let vendor agents come in like any outside party.

**Pick 1.** Delivery is the gap all four leave open. A second inventory competes where the vendors already sync each other, and Aeolus adds least there.

### V2 Listing a fleet ship in a vendor's registry

An admin may want a fleet ship to show beside their own agents in the vendor's registry or agent builder (outcome 3). Gemini Enterprise and Agent Fabric register an outside agent from its A2A card. AgentCore's registry syncs an A2A card or an MCP endpoint, and a curator approves it. Agent 365's registry takes no card or MCP entry: only the Agent 365 SDK (an Entra agent identity blueprint), a manifest upload or a partner integration. Copilot Studio, inside Microsoft's estate, does connect to an A2A agent or MCP server by URL.

1. **No vendor code.** The gateway serves an A2A card and an MCP URL per alias, and the admin pastes or syncs them. In Microsoft's estate a fleet ship is reached through Copilot Studio, not listed in Agent 365.
2. **Option 1 plus the Agent 365 SDK**, so each fleet ship gets an Entra agent identity and shows in Agent 365's registry.
3. **An integration per vendor registry**, with the gateway pushing entries to each.

**Pick 1.** Three of the four take a card or URL already. Options 2 and 3 are vendor-specific work for zero customers (0013).

### V3 Which A2A card versions the gateway serves

The gateway's A2A in (interop slice 4, #878) is designed on A2A 1.0, which puts the card at `/.well-known/agent-card.json`. Agent Fabric and AgentCore use 1.0. Gemini Enterprise pastes 0.3 cards and reaches 1.0 agents through SDK compatibility packages. Copilot Studio reads `/.well-known/agent.json`, the path from before 0.3. All four can already reach fleet ships over MCP in, which is built.

1. **1.0 only**, at `/.well-known/agent-card.json`.
2. **1.0, plus a 0.3 card and the old path**, so Gemini Enterprise and Copilot Studio reach fleet ships by A2A too.

**Pick 1.** It is the version interop is built on, and every platform reaches the fleet by MCP in meanwhile. Each other version is a card shape to keep in step with its spec.

### V4 A vendor agent that signs in with no human

The gateway's MCP in signs an outside MCP client in with the authorization code flow, and only a signed-in account of the fleet asks for it (0056): a human approves and names its owner. Copilot Studio and Agentforce fit, since an admin signs in when connecting. An AgentCore agent calls out with OAuth client credentials, so no human is at the authorize step and no account asks.

1. **An approver adds it**, as an actor holding the approving scope adds an outside MCP server today. The approver names the client, its issuer and subject, the scopes and the owner.
2. **Authorization code only**, as 0056 has it. Machine clients wait for federation (interop slice 6).
3. **Federation now.** The gateway accepts tokens from the Entra, AWS and Google issuers and maps them to proxy ships.

**Pick 1.** It keeps 0056's rule that a human approves and names the owner, without needing a browser at the client. Federation stays slice 6.

### V5 Vendor identity in verified facts

Each platform gives its agents an identity: an Entra agent ID, an AWS workload identity ARN, or a Google SPIFFE ID with a certificate, which covers Google's own runtimes only. 0059 lets a writer record what it checked about a ship from a closed list: `clientIdDocumentDomain`, `tlsHost`, `a2aCardDomain`, and `oauthSubject` with its issuer. Discovery shows these facts beside the statement.

1. **`oauthSubject` with its issuer.** The gateway writes the vendor token's subject and issuer it checked. No new check.
2. **A check per vendor**, such as `entraBlueprint` or `awsArn`, added to the closed list.

**Pick 1.** Every vendor identity reaches the gateway as an OAuth token with an issuer and subject, so the existing check fits. A check per vendor grows the list with each vendor.

### V6 How to prove it

Nothing in this study has been tried against a real vendor client. The gateway's MCP in is built: OAuth sign-in through pagasae, tools from discovery, and a bounded wait with a handle. A2A in is designed but not built (#878).

1. **One tracer bullet first.** A Copilot Studio or Agentforce agent calls a fleet ship through the gateway's MCP in. Each gap found becomes an issue.
2. **Wait for A2A in** and prove the vendor path over A2A first.

**Pick 1.** It needs nothing new built, and a real vendor client shows the sign-in and wait gaps sooner than a design does.

## Sources

Dates are each page's publication or last update; "undated" where the page shows none.

- [M1] https://www.microsoft.com/security/blog/2026/05/01/microsoft-agent-365-now-generally-available-expands-capabilities-and-integrations/ (2026-05-01)
- [M2] https://learn.microsoft.com/en-us/microsoft-agent-365/overview (2026-08-19)
- [M3] https://learn.microsoft.com/en-us/microsoft-copilot-studio/add-agent-agent-to-agent (2026-10-15)
- [M4] https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp (2026-08-26)
- [M5] https://learn.microsoft.com/en-us/microsoft-agent-365/developer/choose-integration-option (2026-09-30); https://learn.microsoft.com/en-us/microsoft-365/admin/manage/agent-registry (2026-10-13)
- [M6] https://learn.microsoft.com/en-us/entra/agent-id/agent-owners-sponsors-managers (2026-04-16)
- [M7] https://learn.microsoft.com/en-us/entra/agent-id/configure-third-party-agents (2026-04-29)
- [M8] https://learn.microsoft.com/en-us/microsoft-agent-365/developer/notification (2026-10-01)
- [G1] https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/gemini-at-work-2025/ (2025-10-09)
- [G2] https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform (2026-04-22)
- [G3] https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/agent-registry (2026-10-21)
- [G4] https://docs.cloud.google.com/gemini/enterprise/docs/register-and-manage-an-a2a-agent (2026-10-14)
- [G5] https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server (undated)
- [G6] https://docs.cloud.google.com/generative-ai-app-builder/docs/reference/rpc/a2a.v1 (undated)
- [G7] https://docs.cloud.google.com/agent-registry/register-agents (2026-10-13)
- [G8] https://cloud.google.com/blog/topics/developers-practitioners/publish-agents-in-gemini-enterprise-and-google-cloud-marketplace (2026-07-08)
- [G9] https://docs.cloud.google.com/iam/docs/agent-identity-overview (2026-10-13)
- [G10] https://docs.cloud.google.com/gemini/enterprise/docs/agent-designer/share-agent (2026-10-14)
- [G11] https://a2a-protocol.org/latest/specification/ (v1.0.0, undated)
- [S1] https://www.salesforce.com/es/news/press-releases/2025/10/14/salesforce-presenta-agentforce-360-la-herramienta-que-eleva-el-potencial-humano-en-la-era-de-la-empresa-agentica/ (2025-10-14)
- [S2] https://docs.mulesoft.com/general/agent-fabric-release-notes (latest entry 2026-10-14)
- [S3] https://www.salesforce.com/blog/connected-agents-agentexchange/ (2025-06-23)
- [S4] https://www.salesforce.com/blog/dreamforce-2026-announcements/ (2026-09-28)
- [S5] https://developer.salesforce.com/blogs/2026/06/the-salesforce-developers-guide-to-the-summer-26-release (2026-06)
- [S6] https://architect.salesforce.com/fundamentals/mulesoft-agent-fabric-deep-dive (undated)
- [S7] https://www.salesforce.com/es/news/press-releases/2026/03/12/mulesoft-agent-fabric/ (2026-03-12)
- [S8] https://docs.mulesoft.com/general/exp-services-create-a2a-bridge (undated)
- [S9] https://docs.mulesoft.com/agent-network/1.0/af-project-files (undated)
- [A1] https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available (2025-10)
- [A2] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/release-notes.html (latest entry 2026-10)
- [A3] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-a2a-protocol-contract.html (undated)
- [A4] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-concepts.html (undated); https://aws.amazon.com/about-aws/whats-new/2026/08/aws-agent-registry-generally-available (2026-08-31)
- [A5] https://aws.amazon.com/about-aws/whats-new/2025/11/marketplace-a2a-server-bedrock-agentcore-runtime/ (2025-11-19)
- [A6] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/key-features-and-benefits.html (undated)
- [A7] https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-long-run.html (undated)
- [A8] https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentrel01-bp01.html (undated)
