# 0001. Acknowledge on receipt

Status: accepted, 2026-09-29

## Context

A delivery needs a clear moment where it leaves the fleet's responsibility. Acknowledging after the work is done would make Aeolus responsible for whether a ship's work succeeds.

## Decision

Aeolus is responsible for distribution, not execution. A ship acknowledges a delivery as soon as it receives it. If the session dies after that, restarting it and recovering the work is the operator's responsibility.

## Rejected

Acknowledge after execution (ties the fleet to the ship's workload); automatic session restarts (a later concern).
