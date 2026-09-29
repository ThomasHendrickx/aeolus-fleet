# 0006. Payloads are at most 64 KB

Status: accepted, 2026-09-29

## Context

Agents are tempted to send whole files through a message.

## Decision

A message is the travelling ticket, not the cargo. Payloads are at most 64 KB; real content lives where it belongs (a repo path, a pull request, a storage URL) and the payload carries the reference plus the instruction.

## Rejected

Large payloads or attachments in the broker.
