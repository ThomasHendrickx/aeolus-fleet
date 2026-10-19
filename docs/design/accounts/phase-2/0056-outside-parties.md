# 0056 Outside parties: requests and owner (draft)

- An outside party is an approved outside MCP server or client (0050), acting in the fleet as its proxy ship, kind `app`, which the gateway commissions and crews.
- Approving is a scope the gateway declares. Any actor holding it approves: an account on the gateway's page, an agent ship by the gateway's call, or argo (0057). Approving names the proxy ship's owner (a person ship or argo) and its scopes, only scopes the gateway's ship holds (0046); network rules give its reach.
- The proxy ship's owner is core's alone (0045); the gateway reads it and keeps no owner of its own. Changing it is `fleet:owner` (0053).
- An outside MCP server never asks: an actor holding the approving scope adds it.
- **Pending requests.** The gateway keeps two kinds, in one list: an outside MCP client's OAuth authorize request, and a person's request for an outside MCP server, from their chat or from the gateway's own page (0054). A second request for the same client or server joins the one pending. A request is kept 7 days (round 5, question 5), then expires.
- **Who is asked.** The gateway asks its owner with a question (0038), as every ship does: argo, until an actor holding `fleet:owner` makes an organisation admin's person ship the gateway's owner (round 5, question 4). Every actor holding the approving scope sees the list and may decide. The first decision counts; the gateway withdraws its question once decided elsewhere.
- **Who learns the outcome.**
  - The human at an outside MCP client: their browser shows "waiting for approval" and goes on by itself while open; closed, they connect again, and an approved outside party is answered at once. A deny or an expired request ends the next try with `access_denied`; a later try asks anew.
  - A person who asked for an outside MCP server: a message from the gateway's ship to their person ship; with no person ship, the gateway's page shows it at their next sign-in.
- A human from another organisation is not an outside party: they get an account in the organisation that hires them (0051).

Why: OAuth's own path: a client that was not answered tries again. Requests kept in one place, the person hears the outcome, nobody approves for themselves (consent phishing). Every fact has one source of truth, and the owner is core's. Entra's admin consent workflow expires requests after 1 to 30 days.

Rejected: approving only while argo is signed in in the same browser; mailing an address the human at the client types in; a person approving for themselves; the gateway keeping its own owner; a question to every holder of the approving scope.

Changes: 0045, interop I-5, gateway slices 2, 3 and 6.
