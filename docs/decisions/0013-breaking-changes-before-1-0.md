# 0013. Breaking changes are allowed before 1.0.0

Status: accepted, 2026-09-29

## Context

The design will still move while v1 is being built. Compatibility layers written this early cost more than they protect.

## Decision

Until version 1.0.0, any release may change the API, the database schema or the ship contract without a compatibility path. Keep designs minimal and change them when needed. From 1.0.0 on, semantic versioning applies in full.

## Rejected

Versioned compatibility from the first release.
