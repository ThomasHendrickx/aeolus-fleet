# 0008 Seven packages; infra private

`@aeolus-fleet/core`, `console`, `common`, `squadrons`, `trierarch-plugin`, `networking-plugin` and `trierarch` as separate packages, Apache-2.0, released in trains (0049). Thomas's hosting lives in private `aeolus-fleet-infra`, consuming the published packages. `squadrons`, `trierarch-plugin`, `networking-plugin` and `trierarch` are optional: a fleet runs without them (decisions 0017, 0026, 0030, 0036).

Why: Anyone can run a fleet.

Rejected: One combined package; infra in public; the trierarch plugin and the trierarch in one package (one runs beside the server, the other on each machine).
