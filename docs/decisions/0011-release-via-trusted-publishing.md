# 0011 Releases only via trusted publishing

- Only `.github/workflows/release.yml` publishes, via npm OIDC. Packages require 2FA and disallow tokens. No npm token anywhere.
- One version for all four packages (squadrons published last); the workflow tags the commit `v<version>` (`contents: write`).
- The aeolus Claude Code plugin carries the same version. The marketplace installs it from main, so after the tag the workflow commits the plugin's version to main; the packages on main keep 0.0.0.
- 0.0.0 is the name placeholder. npm configures a trusted publisher only for a package that exists, so a new package's 0.0.0 is published once by hand by its owner (`npm publish --access public`, no provenance) to claim the name; then its trusted publisher is set to `release.yml` and tokens are disallowed, and from then on only the workflow publishes it.

Why: A leaked token cannot publish; npm and git versions always match.

Rejected: `NPM_TOKEN` secret; publishing releases from a laptop.
