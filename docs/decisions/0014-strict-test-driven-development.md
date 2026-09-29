# 0014. Strict test-driven development

Status: accepted, 2026-09-29

## Context

Aeolus promises that no message is ever lost. Each session builds one slice without the memory of the previous one, so tests are the only lasting proof that a rule or guarantee holds.

## Decision

Server and common code is written test first: a failing test for the next behaviour, the least code to pass it, then refactor. The red step shows in the history as a commit labelled `(red)` containing only the failing test, followed by the commit that makes it pass. Only green heads are pushed. Web code is tested alongside, not strictly first. The practice is described in `.claude/skills/test-driven-development`.

## Rejected

Tests written after the code (no proof the test can fail); test first without evidence in the history (not verifiable by a reviewer).
