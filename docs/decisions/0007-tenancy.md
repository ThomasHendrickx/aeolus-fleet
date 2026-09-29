# 0007. Tenancy built in: every record belongs to a fleet

Status: accepted, 2026-09-29

## Context

v1 runs one fleet, but adding tenancy later means migrating every table and query.

## Decision

Every table except `fleets` carries `fleet_id`, every uniqueness rule is per fleet, and every repository call takes a fleet scope. v1 creates one fleet at first run; more fleets later is a data change, not a schema change.

## Rejected

Single-tenant schema now, retrofit later.

## Amendment, 2026-09-29

One lookup is not scoped by fleet: finding a ship by the hash of its secret (or a console session by the hash of its token). It returns the ship and its fleet; every query after it is scoped. The hash of a random secret is unique across all fleets, enforced by a unique index.
