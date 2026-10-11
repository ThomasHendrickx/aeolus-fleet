# 0011 Releases only via trusted publishing

- Only `.github/workflows/release.yml` publishes, via npm OIDC. Packages require 2FA and disallow tokens. No npm token anywhere.
- Release only releases: it sets the version, builds, dry runs, publishes and tags, with no second test run, since main takes a commit only after CI passed on it.
- It runs only from main and only for a commit whose CI run on main passed: it reads CI's result for that exact commit (`scripts/release-gate.ts`) instead of testing again, and says why in the job log when it refuses.
- One version for the seven published packages (0008): common, core, console, squadrons, trierarch-plugin, networking-plugin and trierarch, in that order, the optional four last; the workflow tags `v<version>` (`contents: write`) a commit on top of the released one that sets the aeolus plugin's manifests to the version, off main's history, so the tag holds the plugin of that version under its version: `aeolus-trierarch upgrade <version>` installs the plugin from it. Tags up to v0.22.0 are the released commit itself, their plugin manifests a version behind.
- After the tag, the workflow creates the GitHub Release `v<version>`, its notes built by `scripts/release-notes.ts` from the merged pull requests carrying the label `<version>`: titles with links, grouped into features, fixes and other changes. No changelog file: git and the labels are the source.
- The aeolus plugin carries the same version. The marketplaces install it from main by default, so after the tag the workflow also commits the plugin's version to main; the packages on main keep 0.0.0.
- 0.0.0 is the name placeholder. npm configures a trusted publisher only for a package that exists, so a new package's 0.0.0 is published once by hand by its owner (`npm publish --access public`, no provenance) to claim the name; then its trusted publisher is set to `release.yml` and tokens are disallowed, and from then on only the workflow publishes it.

Why: A leaked token cannot publish; npm and git versions always match; a harness that installs the plugin from a tag gets the plugin of that release under its version, since both harnesses cache the plugin by its manifest's version.

Rejected for the tag: the released commit itself (its plugin manifests say the version before); a second tag on main's plugin version commit (two tags per release).

Rejected: `NPM_TOKEN` secret; publishing releases from a laptop; running the tests again in the release (the same gate twice).
