# 0010. Leases held until released, no heartbeats in v1

Status: accepted, 2026-09-29

## Context

Turn-based agents cannot reliably send heartbeats, and how they would is a ship template concern.

## Decision

A session that claims a ship holds the lease indefinitely. Only the operator releases it (or the session deregisters). Release ends the lease, invalidates the secret and returns in-flight deliveries. A second claim while a lease is held fails.

## Rejected

Heartbeats with lease expiry (deferred; proposed defaults are in the blueprint's open decisions).
