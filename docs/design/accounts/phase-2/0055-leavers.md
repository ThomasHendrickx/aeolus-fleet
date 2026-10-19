# 0055 Leavers and their computers (draft)

- An organisation admin disables an account; access ends at once, and every ship stays, like an inbox that outlives a leaver. Disabling:
  - ends the account's pagasae sign-ins and refuses new ones;
  - tells the gateway, which ends the account's tokens; a token the gateway still holds is refused at its next refresh, which asks pagasae, so a lost notice ends access within one token's life;
  - ends a console sign-in as argo by that account, through the installation (0054), and takes the account off the accounts allowed to sign in as argo;
  - releases the account's person ship in every fleet (`LeaseRevoked`): the gateway's crew ends, and a pasted crew token stops working (0010);
  - releases every trierarch linked to the account, below.
- Nothing is retired. The person ship keeps its id, history, scopes and the ships it owns; questions and trouble for those ships still go to it until an organisation admin moves them (a later feature) or a human retires it (0045). Enabling the account again lets it sign in; the gateway crews its person ship again.
- **A trierarch is an app and needs an account linked to it.** A computer's trierarch joins for an account: the human signs in to the trierarch plugin's page through pagasae (0054) and adds the computer, and the trierarch plugin commissions the trierarch's app ship owned by that account's person ship, naming the asking ship as owner (`fleet:on-behalf`, widened from naming the asking ship's owner). The link is that owner: one fact, kept by core. A computer that is no human's, such as a shared server, joins as today, owned by argo, linked to no account.
- Disabling the account releases each trierarch's app ship its person ship owns: pagasae releases it on behalf of the person ship, which reaches what it owns by the owner rule (`fleet:on-behalf` widened from read to manage, P6).
- **Releasing a trierarch's ship releases every lease it crewed**, in the same unit of work, so every crew token on that computer stops working. Their crew requests stay, and the trierarch plugin places them on another computer as a request given back (0030). A computer offline at that moment learns it at its next call (`LEASE_ENDED`) and stops.
- When pagasae cannot reach a fleet, it keeps what is still to do for the account and that fleet and tries again until it lands.

Why: Q12, "access ends at once, the ship stays, like an inbox that outlives a leaver; moving its work to another ship is a possible later feature." Q17, "trierarchs are apps and need an account linked to them": without it, a leaver's laptop keeps crewing the organisation's agents after the account is disabled, and J2 says a leaver loses access without a human remembering it. Entra, Okta, Slack and GitHub all deactivate rather than delete (`accounts.md` part 2.2).

Rejected: releasing every ship the person ship owns, wherever crewed (it stops work on shared computers others rely on); retiring the person ship on disable; finding a leaver's computers by hand; a link store beside the owner (two sources of truth); leaving the agent leases of a released trierarch running.

Changes: 0010 (a trierarch's release releases the leases it crewed), 0026, 0030 (a trierarch joins for an account), 0045 (a trierarch's ship may be owned by a person ship), 0046 (`fleet:on-behalf` names the asking ship as owner, and manages on behalf of a ship within its reach).
