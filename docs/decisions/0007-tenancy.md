# 0007 Every record belongs to a fleet

- Every table except `fleets` has `fleet_id`; uniqueness is per fleet; every repository call takes a fleet scope.
- Only exception: lookup by secret hash or session token hash (globally unique index). It returns ship and fleet; everything after is scoped.
- v1 has one fleet; more is a data change.

Why: Retrofitting tenancy means migrating every table and query.

Rejected: Single-tenant now, retrofit later.
