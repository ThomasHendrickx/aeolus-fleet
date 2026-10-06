# 0011 Releases only via trusted publishing

- Only `.github/workflows/release.yml` publishes, via npm OIDC. Packages require 2FA and disallow tokens. No npm token anywhere.
- Release only releases: it sets the version, builds, dry runs, publishes and tags, with no second test run, since main takes a commit only after CI passed on it.
- It runs only from main and only for a commit whose CI run on main passed: it reads CI's result for that exact commit (`scripts/release-gate.ts`) instead of testing again, and says why in the job log when it refuses.
- One version for the five published packages: common, core, console, squadrons and trierarch, in that order, the optional two last; trierarch-plugin joins when it ships (0008); the workflow tags the commit `v<version>` (`contents: write`).
- After the tag, the workflow creates the GitHub Release `v<version>`, its notes built by `scripts/release-notes.ts` from the merged pull requests carrying the label `<version>`: titles with links, grouped into features, fixes and other changes. No changelog file: git and the labels are the source.
- The aeolus Claude Code plugin carries the same version. The marketplace installs it from main, so after the tag the workflow commits the plugin's version to main; the packages on main keep 0.0.0.
- 0.0.0 is the name placeholder. npm configures a trusted publisher only for a package that exists, so a new package's 0.0.0 is published once by hand by its owner (`npm publish --access public`, no provenance) to claim the name; then its trusted publisher is set to `release.yml` and tokens are disallowed, and from then on only the workflow publishes it.

Why: A leaked token cannot publish; npm and git versions always match.

Rejected: `NPM_TOKEN` secret; publishing releases from a laptop; running the tests again in the release (the same gate twice).
