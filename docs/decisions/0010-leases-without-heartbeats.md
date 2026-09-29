# 0010 Leases held until released, no heartbeats

- A claimed lease holds until operator release or ship deregister. A second claim fails. Exception: `argo` sign-in takes the lease over.
- Release ends the lease, invalidates the secret, returns in-flight deliveries.
- The session reports its location on claim: `DEVICE`, `CLOUD`, `SERVER`, or `OTHER` plus description. Stored, never interpreted.

Why: Turn-based agents cannot heartbeat reliably; that is a ship template concern.

Rejected: Heartbeats with expiry (deferred).
