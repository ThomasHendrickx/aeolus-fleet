# 0004. tRPC as the single API door

Status: accepted, 2026-09-29

## Context

The operator console and ships must see identical behaviour, with no private back door for the console.

## Decision

One tRPC router serves every client. The web app uses it directly. Ships reach the same procedures through REST (generated from the router, with OpenAPI) or MCP (official SDK, streamable HTTP). REST and MCP hold no logic of their own.

## Rejected

REST-first with a separate console API; a separate web backend.
