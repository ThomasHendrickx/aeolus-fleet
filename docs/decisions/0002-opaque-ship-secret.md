# 0002. Opaque ship secret instead of JWT

Status: accepted, 2026-09-29

## Context

Ships need a credential the operator can hand out in a starting prompt and revoke instantly.

## Decision

Each ship gets an opaque bearer secret `aeolus_sk_v1_<random>`, stored only as a SHA-256 hash. At most one valid secret per ship. Scopes, when they come, live server-side next to the key.

## Rejected

A signed JWT as the ship credential (cannot be revoked instantly without a deny list). Short-lived JWTs exchanged for the ship key stay possible later, if third parties ever need to verify ships.
