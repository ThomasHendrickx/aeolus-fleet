# 0001 Ack on receipt

A ship acks a delivery when it receives it. Aeolus owns distribution, not execution; a session dying after ack is the operator's to recover. On a pushed ship (0040) the receipt is the agent's: the plugin hook acks when the message comes into the agent's turn, never the trierarch or the watcher.

Why: Ack after execution ties the fleet to the ship's work.

Rejected: Ack after execution; automatic session restarts (later).
