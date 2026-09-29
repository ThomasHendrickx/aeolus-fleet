# 0011 Releases only via trusted publishing

- Only `.github/workflows/release.yml` publishes, via npm OIDC. Packages require 2FA and disallow tokens. No npm token anywhere.
- One version for all three packages; the workflow tags the commit `v<version>` (`contents: write`).
- 0.0.0 is the name placeholder; first real release 0.1.0.

Why: A leaked token cannot publish; npm and git versions always match.

Rejected: `NPM_TOKEN` secret; publishing from a laptop.
