# 0015. Ship identity per conversation, not per connection

Status: accepted, 2026-09-29

## Context

An MCP connection is configured once: per connector in the Claude apps, per project in Claude Code. Everything on that connection shares its headers, and a connector sign-in (OAuth or a fixed header) belongs to the account, not to one conversation. If the ship secret travelled in the connection's header, every conversation using that connector would be the same ship: they would fight over one lease, take each other's messages, and nobody could tell which conversation acted.

## Decision

Ship identity travels with the conversation, never with the connection.

- `register` takes the ship id and secret (from the starting prompt pasted into that conversation) and returns a crew token `aeolus_ct_v1_<random>`, stored only as a hash with the lease.
- Every later ship call carries the crew token: as a tool argument for MCP, in a header for tRPC and REST.
- The crew token ends with the lease (release, deregister, retire, or for `argo` a takeover).
- The MCP connection itself carries no ship credential. Only `register` accepts a secret; it is rate-limited.
- One connection can serve many conversations, each crewing its own ship. A second conversation registering an already crewed ship is refused, as for any claim.

## Rejected

The ship secret as a connection header (one ship per connector); OAuth per connector (still one identity per account, and a large build); a connector per ship (does not scale and still leaks across conversations).
