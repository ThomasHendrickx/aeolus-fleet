# 0056 Outside parties: requests and owner (draft)

- An outside party is an approved outside MCP server or client (0050), acting in the fleet as its proxy ship, kind `app`, which the gateway commissions and crews.
- Approving is a scope the gateway declares. A ship holding it approves on the gateway's page: argo, or a person ship signed in through pagasae (0053, 0054). Approving names the proxy ship's owner (a person ship or argo) and its scopes, only scopes the gateway's ship holds (0046); network rules give its reach.
- The proxy ship's owner is core's alone (0045); the gateway reads it from the fleet and keeps no owner of its own. Changing it is `fleet:owner` (0053).
- An outside MCP server never asks: a ship holding the approving scope adds it on the gateway's page.
- **Pending requests.** The gateway keeps two kinds, in one list on its page:
  - an outside MCP client's OAuth authorize request, from the human at that client;
  - a person's request for an outside MCP server, from their chat through the gateway's person tools or from the gateway's own page (0054).
  A second request for the same client or the same server joins the one pending. A request is kept 7 days (P8), then expires.
- **Who is asked.** The gateway asks its owner with a question (0038), as every ship does: argo, until a ship holding `fleet:owner` makes an organisation admin's person ship the gateway's owner (P7). Every ship holding the approving scope sees the list on the gateway's page and may decide there. The first decision counts; the gateway withdraws its question once decided on the page.
- **Who learns the outcome.**
  - The human at an outside MCP client: their browser shows "waiting for approval" and goes on by itself while open; closed, they connect again, and an approved outside party is answered at once. A deny, or an expired request, ends the next try with `access_denied`; a later try asks anew.
  - A person who asked for an outside MCP server: a message from the gateway's ship to their person ship, with the outcome.
- A human from another organisation is not an outside party: they get an account in the organisation that hires them (0051).

Why: Q20, OAuth's own path: a client that was not answered tries again. Q7: requests kept in one place, the person hears the outcome on their own ship, and nobody approves for themselves (consent phishing, `accounts.md` part 2.2). Q16: every fact has one source of truth, and the owner is core's. The question goes to the owner as every question does, so no second way of asking; an organisation that wants Mathilde asked makes her the gateway's owner. Entra's admin consent workflow expires requests after 1 to 30 days.

Rejected: approving only while argo is signed in in the same browser; mailing an address the human at the client types in; a person approving for themselves; the gateway keeping its own owner beside core's; asking every holder of the approving scope with a question each.

Changes: 0045 (the gateway names no owner of its own), interop I-5, gateway slices 2, 3 and 6.
