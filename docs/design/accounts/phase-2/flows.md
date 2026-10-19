# Accounts, phase 2: the flows that change

Each flow shows its happy path and its unhappy paths, in the domain language, on the actor model (0057): a ship, an account by its account token, or the installation. The drafts they follow are in this folder's [README](README.md).

## F1 Sign-up

Drafts 0051, 0058. Mathilde signs Acme up for hosted Aeolus.

```mermaid
sequenceDiagram
  actor M as Mathilde
  participant P as pagasae
  participant I as core (installation)
  participant C as core (the new fleet)
  M->>P: sign up: email, organisation name, fleet name, terms accepted
  P-->>M: sign-in link
  alt link opened within its time
    M->>P: open the sign-in link
  else link expired or used
    P-->>M: refused: ask for a new sign-in link
  end
  P->>P: organisation, Mathilde's account (organisation admin, allowed to sign in as argo of the first fleet)
  P->>I: create the fleet (request id)
  alt created
    I->>C: fleet, argo, the installation's scopes there
    I-->>P: the fleet
    P->>C: as the installation: define the label group
    P-->>M: your organisation and its first fleet
  else installation refuses (fleet cap, name taken)
    I-->>P: refused, naming why
    P-->>M: the organisation exists, the fleet does not: why, and try another name
  else no answer
    P->>I: the same create, the same request id, until answered
    Note over P,I: a replay answers the first answer (0020), so no second fleet
  end
```

## F2 An account joins a group

Draft 0052. Mathilde adds Charlotte to Acme and to the group "sales", which in Acme's fleet gives `fleet:read`, messaging, and the reach "sales sends to sales".

```mermaid
sequenceDiagram
  actor M as Mathilde (organisation admin)
  participant P as pagasae
  participant C as core (fleet)
  participant N as Networking plugin
  actor CH as Charlotte
  M->>P: add the account charlotte@acme.com, in the group sales
  alt Mathilde is not an organisation admin
    P-->>M: refused
  else the account would have more than 20 groups giving something in this fleet
    P-->>M: refused: at most 20 (0031)
  else allowed
    P->>P: the account, in sales
    alt sales has no value of the label group yet
      P->>C: as the installation: add the value sales to group, declare sales sends to sales
      C->>N: NetworkRulesDeclared
      N->>C: the fleet's rules again, the declared ones in force
    end
    alt sales lets its accounts message, and Charlotte has no person ship there
      P->>C: as the installation: commission her person ship, owner argo, messaging scopes, group=sales
      C-->>P: the person ship (ShipCommissioned, OwnerSet)
      P->>P: link the account to the person ship
    end
    P-->>M: Charlotte added
    P-->>CH: sign-in link
  end
  Note over P,C: Charlotte's rights are not written in the fleet: her account token carries sales' scopes and group=sales from her first sign-in
  alt core does not answer pagasae
    P->>P: keep what is still to do for this account and fleet
    P->>C: again until it lands
  end
```

## F3 A group's rights change

Draft 0052. Charlotte moves from sales to finance while she is signed in at the gateway with a person ship.

```mermaid
sequenceDiagram
  actor M as Mathilde (organisation admin)
  participant P as pagasae
  participant C as core (fleet)
  participant G as Gateway
  M->>P: move Charlotte from sales to finance
  P->>C: as the installation: her person ship's group=sales off, group=finance on
  P-->>M: moved
  G->>C: a call with Charlotte's account token, issued before the move
  C-->>G: allowed by sales' scopes until that token ends (at most 10 minutes)
  G->>P: a fresh account token for Charlotte
  P-->>G: finance's scopes and group=finance
  G->>C: her next call
  alt within finance's scopes and reach
    C-->>G: OK
  else needs a scope or reach only sales gave
    C-->>G: refused, without reasons
  end
  alt core did not answer pagasae
    P->>C: the person ship's labels again until they land
    Note over P,C: her account's rights do not wait on it: they ride on the token
  end
```

## F4 An admin acts as their account

Drafts 0053, 0057. Thomas is in "team leads" (`fleet:commission`, `fleet:manage`), with a rule letting `group=engineering` manage `group=engineering`. He works from his Claude through the gateway. Mathilde edits a rule on the networking plugin's page. An agent ship does the same by call.

```mermaid
sequenceDiagram
  actor T as Thomas
  participant G as Gateway
  participant P as pagasae
  participant C as core (fleet)
  actor M as Mathilde
  participant N as Networking plugin (its page)
  T->>G: commission an agent for engineering, labelled group=engineering
  alt Thomas's account has no person ship in this fleet
    G->>P: Thomas will own a ship: his person ship
    P->>C: as the installation: commission and link it
    P-->>G: a fresh account token naming it
  end
  G->>C: commission, with Thomas's account token
  C->>C: check the token, then fleet:commission, labels it carries, owner his person ship
  alt lacks the scope, or a label value it neither defined nor carries
    C-->>G: refused, naming the scope or the value
  else allowed
    C-->>G: the agent ship, owner Thomas's person ship (OwnerSet, actor Thomas's account via the gateway)
  end
  T->>G: retire the finance invoice agent
  G->>C: retire, with Thomas's account token
  C-->>G: refused, without reasons (no manage rule reaches it)
  M->>N: open the networking plugin's page
  N->>P: sign Mathilde in
  P-->>N: her account token for this fleet
  M->>N: add a rule
  alt her token holds the plugin's editing scope
    N->>C: the fleet's rules, as the networking plugin's ship
    C-->>N: in force (NetworkRulesSet)
    N-->>M: saved, naming her account in its log
  else it does not
    N-->>M: the rules, and no editing
  end
  Note over N,C: an agent ship holding the same scope calls the networking plugin with its crew token and does the same
```

## F5 Gateway sign-in

Drafts 0054, 0058. Charlotte adds the gateway's one address to her Claude.

```mermaid
sequenceDiagram
  actor H as Charlotte
  participant MC as Her Claude
  participant G as Gateway (one address)
  participant P as pagasae
  participant C as core (fleet)
  H->>MC: add the gateway's address
  MC->>G: OAuth authorize request
  G->>P: sign in (OpenID Connect)
  alt directory connected
    P->>H: sign in with your identity
    H-->>P: identity
  else not connected, or it fails and the account may sign in as argo
    P-->>H: sign-in link
    H->>P: open the sign-in link
  end
  alt email in several organisations
    P->>H: which organisation?
    H-->>P: Acme
  end
  alt account disabled
    P-->>G: refused
    G-->>MC: access_denied
  else no group gives anything in any fleet
    G-->>H: refused: ask an organisation admin
  else one or more fleets
    alt several fleets
      G->>H: pick a fleet
      H-->>G: Acme's main fleet
    end
    G->>P: Charlotte's account token for that fleet
    G-->>MC: code, then the gateway's token naming that fleet
    MC->>G: read the fleet
    G->>C: the call, with her account token
    MC->>G: send to the CRM
    alt she has a person ship
      G->>C: crew it, if the gateway does not yet
      alt crewed by a pasted crew token
        C-->>G: refused: crewed
        G-->>H: your ship is crewed elsewhere: release that crew?
        H->>G: release it
        G->>P: release Charlotte's person ship
        P->>C: as the installation: release (LeaseRevoked)
        G->>C: crew it
      end
      G->>C: send, as her person ship
    else no group lets her message here
      G-->>MC: refused: no messaging in this fleet
    end
  end
  alt pagasae down
    G-->>MC: calls go on until her account token ends, then fail: try later
    Note over G,C: messaging through her person ship goes on: its lease is the gateway's
  end
```

## F6 Console sign-in as argo

Draft 0054. Mathilde signs in as argo of Acme's fleet; Thomas tries without being allowed; a self-hoster uses argo's own sign-in.

```mermaid
sequenceDiagram
  actor M as Mathilde
  actor T as Thomas
  participant P as pagasae
  participant K as Console
  participant C as core (fleet)
  M->>P: sign in as argo of Acme's fleet
  alt allowed by an organisation admin
    P->>C: sign-in ticket naming Mathilde's account (installation)
    C-->>P: the ticket (2 minutes, one use)
    P-->>M: to the console with the ticket
    M->>K: redeem the ticket
    K->>C: start the console sign-in as argo
    C->>C: end any other console sign-in as argo, take argo's lease over
    C-->>K: signed in as argo, by mathilde@acme.com
    M->>K: retire a ship
    K->>C: retire, as argo
    C->>C: ShipRetired, actor argo, its details naming Mathilde's account
  else not allowed
    P-->>M: refused
  end
  T->>P: sign in as argo of Acme's fleet
  P-->>T: refused: not allowed for this fleet
  Note over K,C: without pagasae, the console's form takes argo's own email and password, and the sign-in says so. Wrong password: refused. Hosted: no form.
```

## F7 A trierarch joins for an account

Draft 0055. Burak adds his laptop.

```mermaid
sequenceDiagram
  actor B as Burak
  participant TP as Trierarch plugin (its page)
  participant P as pagasae
  participant C as core (fleet)
  participant L as Burak's laptop
  B->>TP: open the trierarch plugin's page
  TP->>P: sign Burak in
  alt account disabled
    P-->>TP: refused
  else signed in
    P-->>TP: Burak's account token for this fleet
    B->>TP: add this computer
    alt his token lacks the plugin's scope to add a computer
      TP-->>B: refused
    else allowed
      alt no person ship named in his token
        TP->>P: Burak will own a ship: his person ship
        P->>C: as the installation: commission and link it
        P-->>TP: a fresh token naming it
      end
      TP->>C: commission the trierarch's app ship, owner Burak's person ship (fleet:on-behalf)
      C-->>TP: the ship (ShipCommissioned, OwnerSet)
      TP-->>B: the starting prompt for aeolus-trierarch init
      B->>L: aeolus-trierarch init with it
      L->>C: register the trierarch's ship
      C-->>L: crew token
    end
  end
  Note over TP,C: a shared server joins as today, owned by argo, linked to no account
```

## F8 An account is disabled

Drafts 0055, 0058. Burak leaves Acme. He was signed in at the gateway, allowed to sign in as argo, and his laptop's trierarch crews three agent ships.

```mermaid
sequenceDiagram
  actor M as Mathilde (organisation admin)
  participant P as pagasae
  participant G as Gateway
  participant I as core (installation)
  participant C as core (fleet)
  participant TP as Trierarch plugin
  participant L as Burak's laptop
  M->>P: disable Burak's account
  alt Burak is the last organisation admin
    P-->>M: refused: the organisation needs one
  else disabled
    P->>P: end his pagasae sign-ins, off the accounts allowed as argo, no new tokens
    P->>I: cut off Burak's account tokens
    I->>C: refuse them until the last has ended
    P->>I: end console sign-ins by Burak's account
    P->>G: account disabled
    G->>G: end his gateway tokens
    P->>C: as the installation: release his person ship (LeaseRevoked)
    P->>C: as the installation: release his trierarch's ship
    C->>C: and every lease it crewed (LeaseRevoked each)
    C-->>TP: the fleet's events: those crew requests given back
    TP->>C: assign them to another computer
    P-->>M: disabled
  end
  L->>C: the next call with any of its crew tokens
  C-->>L: LEASE_ENDED
  L->>L: stop the sessions
  alt the cut-off did not reach core
    Note over P,C: his last account token ends within 10 minutes, and pagasae gives no new one
    P->>I: the cut-off and releases again until they land
  end
```

## F9 An outside MCP client waits

Draft 0056. A supplier's ordering agent asks to reach Acme's fleet. It replaces `domain-model.md` 2.5b.

```mermaid
sequenceDiagram
  actor R as Human at the client
  participant MC as Outside MCP client
  participant G as Gateway
  participant C as core (fleet)
  actor A as The gateway's owner (argo or a person)
  actor M as Mathilde (holds the approving scope)
  R->>MC: add Acme's MCP address
  MC->>G: OAuth authorize request (in the human's browser)
  alt outside party approved before
    G-->>MC: code, then a token, at once
  else denied, or the client unknown (no client metadata)
    G-->>MC: access_denied
  else the same client already pending
    G-->>R: waiting for approval (joins that request)
  else new
    G->>G: pending request, kept 7 days
    G->>C: question (0038) to its owner: approve this outside MCP client?
    C->>A: delivery of the question
    G-->>R: waiting for approval
    alt decided on the gateway's page first, by an actor holding the approving scope
      M->>G: approve, with her account token: owner Charlotte's person ship, scopes
      G->>C: withdraw the question
    else answered by the question
      A->>C: answer: approve, owner and scopes
      C->>G: delivery of the answer
    end
    alt approved
      G->>C: commission and crew the proxy ship (kind app), owner and scopes
      alt scopes beyond what the gateway's ship holds
        C-->>G: refused, naming the scope
        G->>C: question to its owner: approved, but the gateway cannot grant that scope
      else commissioned
        alt browser still open
          G-->>MC: code, then a token
        else browser closed
          R->>MC: connect again
          MC->>G: OAuth authorize request
          G-->>MC: code at once, then a token
        end
      end
    else denied
      G-->>MC: access_denied, now or on the next try
    else 7 days, no decision
      G->>G: expired, question withdrawn
      G-->>MC: access_denied on the next try, which asks anew
    end
  end
  MC->>G: call a tool, as the outside party
  G->>C: send as the proxy ship, within its scopes and reach
```

## F10 A person asks for an outside MCP server

Draft 0056. Charlotte wants her PRD agent to read tickets from Linear's MCP server.

```mermaid
sequenceDiagram
  actor CH as Charlotte
  participant G as Gateway (person tools or its own page)
  participant C as core (fleet)
  actor M as Mathilde (holds the approving scope)
  participant OS as Linear's MCP server
  CH->>G: ask for Linear's MCP server, and why (her account token)
  alt already an outside party
    G-->>CH: already approved: ask for reach if your ships do not reach it
  else already pending
    G-->>CH: waiting for approval (joins that request)
  else new
    G->>G: pending request, kept 7 days
    G->>C: question (0038) to its owner
    G-->>CH: waiting for approval
    M->>G: decide on the gateway's page
    alt approved: its credential, owner Charlotte's person ship, scopes
      G->>OS: list its tools
      alt the server answers
        G->>C: commission and crew the proxy ship, statement one capability per tool
        G->>CH: approved
      else no answer, or the credential is refused
        G-->>M: not added: the server's answer
        Note over G,M: the request stays pending for Mathilde to try again
      end
    else denied
      G->>CH: denied, with Mathilde's note
    else 7 days, no decision
      G->>CH: expired
    end
    G->>C: withdraw the question
  end
  Note over G,CH: the outcome reaches Charlotte as a message to her person ship, or on the gateway's page at her next sign-in when she has none
```

## F11 An account token is checked

Draft 0058. Every call with an account token, its unhappy paths, and pagasae rotating its key.

```mermaid
sequenceDiagram
  participant X as Gateway or a plugin's page
  participant P as pagasae
  participant C as core (fleet)
  X->>P: an account token for Charlotte, for this fleet
  P-->>X: the token: account, organisation, fleet, scopes, group values, person ship, 10 minutes, key id
  X->>C: a call with the token
  alt key id unknown to core
    C->>P: pagasae's keys (at most once a minute)
    P-->>C: the keys, old and new
  end
  alt signature bad, issuer or fleet wrong
    C-->>X: refused
  else ended (beyond 30 seconds of allowance)
    C-->>X: refused: token ended
    X->>P: a fresh one
  else account cut off, token issued before the cut-off
    C-->>X: refused
  else valid
    C->>C: authorise by its scopes and reach, as any actor
    C-->>X: the answer, events naming Charlotte's account, through X
  end
  alt pagasae down
    X->>P: a fresh token
    P--xX: no answer
    X-->>X: calls stop as the last token ends, messaging on her person ship goes on
  end
```
