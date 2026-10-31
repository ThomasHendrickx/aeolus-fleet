# 0006 Payloads and statements max 256 KB

A message is the ticket, not the cargo: max 256 KB of serialized payload bytes in UTF-8, carrying a reference (repo path, PR, URL) plus the instruction. A ship's statement (0047) has the same limit, as the UTF-8 bytes of its JSON: one limit, not an exception.

Why: Keeps the broker small and fast. 64 KB was too small: an outside MCP server's tools with their schemas ran past it, so its proxy ship stated nothing (aeolus-fleet#1418).

Rejected: Large payloads or attachments; a larger limit for statements alone; trimming a statement to fit.
