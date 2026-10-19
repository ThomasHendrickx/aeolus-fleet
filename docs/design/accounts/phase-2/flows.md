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
