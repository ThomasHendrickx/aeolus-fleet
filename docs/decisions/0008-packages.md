# 0008 Three packages, one repo; infra private

`@aeolus-fleet/server`, `web`, `common` in this public Apache-2.0 repo, one version. Thomas's hosting lives in private `aeolus-fleet-infra`, consuming the published packages.

Why: Anyone can run a fleet; one version while the packages move together.

Rejected: One combined package; separate repos per package; infra in public.
