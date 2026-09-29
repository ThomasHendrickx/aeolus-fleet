# 0001 Ack on receipt

A ship acks a delivery when it receives it. Aeolus owns distribution, not execution; a session dying after ack is the operator's to recover.

Why: Ack after execution ties the fleet to the ship's work.

Rejected: Ack after execution; automatic session restarts (later).
