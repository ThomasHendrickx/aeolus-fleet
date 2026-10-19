# Accounts, phase 2: the flows that change

Each flow shows its happy path and its unhappy paths, in the domain language. The drafts they follow are in this folder's [README](README.md).

## F1 Sign-up

Draft 0051. Mathilde signs Acme up for hosted Aeolus.

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
  P->>I: create the fleet, with pagasae connected (request id)
  alt created
    I->>C: fleet, argo, pagasae's plugin ship with the scopes groups may give
    I-->>P: the fleet
    P->>C: as pagasae's ship: define the label group
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

Draft 0052. Mathilde adds Charlotte to Acme and to the group "sales", which gives `fleet:read` and the reach "sales sends to sales" in Acme's fleet.

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
  else the account already has 20 groups giving something in this fleet
    P-->>M: refused: at most 20 groups on one person ship (0031)
  else allowed
    P->>P: the account, in sales
    alt no person ship for the account in the fleet
      P->>C: commission a person ship (fleet:person), owner argo, scopes of sales
      C-->>P: the person ship (ShipCommissioned, OwnerSet)
      P->>P: link the account to the person ship
    else a person ship already
      P->>C: grant the scopes sales adds (ScopesChanged)
    end
    alt sales has no value of the label group yet
      P->>C: add the value sales to the label group
    end
    P->>C: assign group=sales on the person ship
    P->>C: declare pagasae's rules, with sales sends to sales
    C->>N: NetworkRulesDeclared
    N->>C: the fleet's rules again, the declared ones in force
    P-->>M: Charlotte added
    P-->>CH: sign-in link
  end
  alt core does not answer
    P->>P: keep what is still to do, for this account and fleet
    P->>C: the same change again until it lands
    Note over P,C: the next sign-in checks it too (F5)
  end
```

## F3 A group's rights change

Draft 0052. Charlotte moves from sales to finance while she is signed in at the gateway and her agent is crewed.

```mermaid
sequenceDiagram
  actor M as Mathilde (organisation admin)
  participant P as pagasae
  participant C as core (fleet)
  participant G as Gateway (crews Charlotte's person ship)
  M->>P: move Charlotte from sales to finance
  P->>C: revoke the scopes only sales gave, grant finance's (ScopesChanged)
  P->>C: unassign group=sales, assign group=finance
  P-->>M: moved
  G->>C: Charlotte's next call, as her person ship
  alt within finance's scopes and reach
    C-->>G: OK
  else needs a scope or reach sales gave
    C-->>G: refused, without reasons
  end
  alt core did not answer pagasae
    P->>C: the same change again until it lands
    Note over P,G: at Charlotte's next sign-in pagasae checks her ship against her groups and puts right what differs
  end
```

## F4 An admin acts as their person ship

Draft 0053. Thomas, engineering's team lead, is in the group "team leads", which gives `fleet:commission` and `fleet:manage`; a rule lets `group=engineering` manage `group=engineering`. He works from his Claude, signed in at the gateway. Mathilde, in "fleet admins", edits a rule on the networking plugin's page, signed in through pagasae.

```mermaid
sequenceDiagram
  actor T as Thomas
  participant G as Gateway (crews Thomas's person ship)
  participant C as core (fleet)
  actor M as Mathilde
  participant N as Networking plugin (its page)
  participant P as pagasae
  T->>G: commission an agent for engineering, labelled group=engineering
  G->>C: commission, as Thomas's person ship
  alt lacks fleet:commission
    C-->>G: refused, naming the scope
  else a label value it neither defined nor carries, or a scope it does not hold
    C-->>G: refused, naming the value or the scope
  else allowed
    C-->>G: the agent ship, owner Thomas's person ship (OwnerSet)
  end
  G-->>T: the answer
  T->>G: retire the finance invoice agent
  G->>C: retire, as Thomas's person ship
  C->>C: manage reach: no rule lets group=engineering manage that ship
  C-->>G: refused, without reasons
  G-->>T: refused
  M->>N: open the networking plugin's page
  N->>P: sign Mathilde in
  P-->>N: Mathilde's person ship in this fleet
  M->>N: add a rule
  alt her person ship holds the plugin's editing scope
    N->>C: the fleet's rules, as the networking plugin's ship
    C-->>N: in force (NetworkRulesSet)
    N-->>M: saved, naming her person ship in its log
  else it does not
    N-->>M: the page shows the rules and no editing
  end
```

## F5 Gateway sign-in

Draft 0054. Charlotte adds the gateway's one address to her Claude.

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
    H-->>P: identity from the identity provider
  else not connected, or the identity provider fails and the account may sign in as argo
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
  else no person ship in any fleet
    P-->>G: the account, no fleet
    G-->>H: refused: ask an organisation admin
  else one or more fleets
    P->>C: put the person ship right against its groups (0052)
    P-->>G: the account, its organisation, its fleets with their person ships
    alt several fleets
      G->>H: pick a fleet
      H-->>G: Acme's main fleet
    end
    G->>G: token naming that fleet
    G-->>MC: code, then the token
    alt the person ship is not crewed by the gateway yet
      G->>C: crew the person ship (hold its lease)
    else crewed by another crew (a pasted crew token)
      C-->>G: refused: crewed
      G-->>H: your ship is crewed elsewhere: release that crew?
      H->>G: release it
      G->>P: release Charlotte's person ship
      P->>C: release, as pagasae's ship (LeaseRevoked)
      G->>C: crew the person ship
    end
    MC->>G: send, read, answer, as Charlotte
    G->>C: the call as her person ship
  end
```

The last unhappy path is a person ship still crewed by a pasted crew token, today's only way in. The gateway asks the human, and pagasae, which manages the person ships it commissioned (0052), releases the old crew.

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
    C->>C: ShipRetired, its details naming Mathilde's account
  else not allowed
    P-->>M: refused
  end
  T->>P: sign in as argo of Acme's fleet
  P-->>T: refused: not allowed for this fleet
  Note over K,C: self-hosted without pagasae: the console's form takes argo's own email and password, and the sign-in says so. Wrong password: refused, as today. Hosted: no form.
```
