# 0008. Server, web and common as separate packages; infra private

Status: accepted, 2026-09-29

## Context

Anyone should be able to run their own fleet, while Thomas's own hosting stays private.

## Decision

Three npm packages under the `aeolus-fleet` org: `@aeolus-fleet/server`, `@aeolus-fleet/web`, `@aeolus-fleet/common`, in this public Apache-2.0 repo. Thomas's Hetzner setup lives in the private `aeolus-fleet-infra` repo and consumes the published packages like any installer.

## Rejected

One combined package; infra in the public repo.
