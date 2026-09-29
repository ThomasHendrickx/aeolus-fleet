# 0005. Prefixed, time-ordered ids

Status: accepted, 2026-09-29

## Context

Ids appear in logs, prompts, URLs and conversations with agents.

## Decision

Every id is prefixed with what it refers to (`flt_`, `shp_`, `msg_`, `dlv_`, `evt_`) and sorts by creation time. Ship names are the human handle; ids are the stable reference.

## Rejected

Plain UUIDs (not readable, not searchable by humans).

## Amendment, 2026-09-29

Answered by Thomas while building slice 0 (walking skeleton):

- The part after the prefix is a lowercase ULID: 26 Crockford base32 characters holding a 48-bit Unix millisecond timestamp followed by 80 random bits. Ids of one kind sort as plain text in creation order, and a generator stays strictly ordered within one millisecond. `common/src/ids` implements it without a dependency.
- The tables without a prefix of their own get four more: `lse_` (lease), `crd_` (credential), `opr_` (operator) and `ses_` (operator session).

Rejected: TypeID (a UUIDv7 in base32, 74 random bits) and UUIDv7 in hex (longer and less readable in prompts).

## Amendment 2, 2026-09-29

`opr_` is retired: there is no operator account any more (decision 0012). `ses_` now names a console session.
