# 0049 Release trains, one repository each

- The packages ship in release trains, each with its own version, release workflow and repository:
  - core: common, core and console;
  - the trierarch: the trierarch, the Aeolus Fleet plugin and the session image;
  - squadrons; the trierarch plugin: one train each;
  - the A2A gateway (0048): its own train and repository from its first commit.
- 0.27.1 is the last release with one version for all packages. Each train's first release of its own is 0.28.0.
- Every train other than core consumes `@aeolus-fleet/common` from npm at a stated version.
- What a package of another train needs from core is stated in docs/compatibility.md. Each of squadrons, the trierarch plugin, the trierarch and the gateway states the minimum core version it needs, and refuses to start against an older core, saying both versions. This is a minimum version check, not a compatibility layer (0013).
- Every train stays Apache-2.0 until the licence of a part is decided.

Why: A fix to one part republishes only its train: a console fix no longer moves every machine and harness (v0.26.1), or takes a hotfix branch because main holds other parts' work (v0.24.1). The parts that move together stay one version. A repository per train lets a part's licence and visibility differ later.

Rejected: one version for all packages; an independent version per package (the trierarch and the Aeolus Fleet plugin move together); one monorepo with a workflow per train; a compatibility layer between versions.
