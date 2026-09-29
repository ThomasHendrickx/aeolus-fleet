# 0003. Postgres is the broker

Status: accepted, 2026-09-29

## Context

The delivery guarantee must survive a crash of the server process, and v1 runs on one small server.

## Decision

Messages and deliveries are rows in Postgres. Send stores the message and its deliveries in one transaction before returning OK. Receive claims with `FOR UPDATE SKIP LOCKED`. `LISTEN/NOTIFY` wakes waiting receivers after commit.

## Rejected

A separate queue product or job library (a second system to run, and deliveries are domain objects with their own states and history).
