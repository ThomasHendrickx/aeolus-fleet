# 0003 Postgres is the broker

Messages and deliveries are Postgres rows. Send commits message plus deliveries before OK. Receive claims with `FOR UPDATE SKIP LOCKED`. `LISTEN/NOTIFY` wakes receivers after commit.

Why: Guarantee survives a process crash; one system to run.

Rejected: A queue product or job library.
