# 0005. Prefixed, time-ordered ids

Status: accepted, 2026-09-29

## Context

Ids appear in logs, prompts, URLs and conversations with agents.

## Decision

Every id is prefixed with what it refers to (`flt_`, `shp_`, `msg_`, `dlv_`, `evt_`) and sorts by creation time. Ship names are the human handle; ids are the stable reference.

## Rejected

Plain UUIDs (not readable, not searchable by humans).
