# 0006 Payloads max 64 KB

A message is the ticket, not the cargo: max 64 KB of serialized payload bytes, carrying a reference (repo path, PR, URL) plus the instruction.

Why: Keeps the broker small and fast.

Rejected: Large payloads or attachments.
