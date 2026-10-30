# 0007 Every record belongs to a fleet

- Every table except `fleets` has `fleet_id`; uniqueness is per fleet; every repository call takes a fleet scope.
- Only exceptions: lookup by secret hash, session token hash, or operator email (globally unique). They return the fleet; everything after is scoped. The installation procedures read and delete across fleets, and the installation owns its own tables: `installation_requests` (decision 0020), `installation_settings`, `notices`, `guides` and `account_cut_offs`.
- A self-hosted server has one fleet; a hosting installation creates many.

Why: Retrofitting tenancy means migrating every table and query.

Rejected: Single-tenant now, retrofit later.
