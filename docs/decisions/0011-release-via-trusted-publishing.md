# 0011. Releases publish only through trusted publishing

Status: accepted, 2026-09-29

## Context

The three packages are public on npm. A leaked npm token would let anyone publish a malicious version under the `@aeolus-fleet` name.

## Decision

Releases are published only by the GitHub Actions workflow `.github/workflows/release.yml` in this repo, through npm trusted publishing (OIDC). All three packages are configured for that workflow file name, and their publishing access is set to require two-factor authentication and disallow tokens. No npm token exists in the repo or its secrets. Provenance attestations are generated automatically. The three packages are released together with one version.

The 0.0.0 versions on npm are name placeholders; the first real release is 0.1.0.

## Rejected

An `NPM_TOKEN` secret in GitHub Actions; publishing from a laptop.

## Amendment, 2026-09-29

A release also tags the released commit `v<version>` in the same workflow, so every version on npm matches a tag in git. The workflow needs `contents: write` for that; npm still authenticates through OIDC only.
