# 0010 Leases held until released, no heartbeats

- A claimed lease holds until operator release or ship deregister. A second claim fails. Exception: `argo` sign-in takes the lease over.
- Release and deregister both end the lease, invalidate the secret and return in-flight deliveries. The next crew needs a new starting prompt.
- A lost `register` reply leaves the ship crewed by an unheld token; the operator releases. Accepted for v1.
- The session reports its location on claim: `DEVICE`, `CLOUD`, `SERVER`, or `OTHER` plus description. Stored, never interpreted.

Why: Turn-based agents cannot heartbeat reliably; that is a ship class concern.

Rejected: Heartbeats with expiry (deferred).
