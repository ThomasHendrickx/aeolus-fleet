# 0008 Separate packages; infra private

Separate packages, Apache-2.0, released in the trains and repositories 0049 lists: `@aeolus-fleet/core`, `console`, `common` and `ui` in core's, and squadrons, the trierarch plugin, the trierarch and the gateway each in its own. Thomas's hosting lives in private `aeolus-fleet-infra`, consuming the published packages. Squadrons, the trierarch plugin, the trierarch and the gateway are optional: a fleet runs without them (decisions 0017, 0026, 0030, 0048). `@aeolus-fleet/ui` holds the UI parts every Aeolus web app shows: the apps depend on it, and it depends on no app and on no package but `common`, for types only.

Why: Anyone can run a fleet.

Rejected: One combined package; the shared UI parts in `common` (common stays React-free); infra in public; the trierarch plugin and the trierarch in one package (one runs beside the server, the other on each computer).
