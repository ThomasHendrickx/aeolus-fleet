-- Every foreign key gets an index leading with its columns (#331): deleting a
-- referenced row checks the rows that reference it with an index, not a
-- sequential scan, so a long-lived fleet can still be deleted.
-- CreateIndex
CREATE INDEX "leases_fleet_id_ship_id_idx" ON "leases"("fleet_id", "ship_id");

-- CreateIndex
CREATE INDEX "credentials_fleet_id_ship_id_idx" ON "credentials"("fleet_id", "ship_id");

-- CreateIndex
CREATE INDEX "messages_fleet_id_selector_ship_id_idx" ON "messages"("fleet_id", "selector_ship_id");

-- CreateIndex
CREATE INDEX "messages_fleet_id_in_reply_to_message_id_idx" ON "messages"("fleet_id", "in_reply_to_message_id");

-- CreateIndex
CREATE INDEX "messages_fleet_id_resend_of_message_id_idx" ON "messages"("fleet_id", "resend_of_message_id");

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_message_id_idx" ON "deliveries"("fleet_id", "message_id");

-- CreateIndex
CREATE INDEX "deliveries_fleet_id_claimed_by_ship_id_idx" ON "deliveries"("fleet_id", "claimed_by_ship_id");

-- CreateIndex
CREATE INDEX "events_fleet_id_actor_ship_id_idx" ON "events"("fleet_id", "actor_ship_id");

-- CreateIndex
CREATE INDEX "events_fleet_id_ship_id_idx" ON "events"("fleet_id", "ship_id");

-- CreateIndex
CREATE INDEX "events_fleet_id_message_id_idx" ON "events"("fleet_id", "message_id");

-- CreateIndex
CREATE INDEX "events_fleet_id_delivery_id_idx" ON "events"("fleet_id", "delivery_id");

-- CreateIndex
CREATE INDEX "console_sessions_fleet_id_ship_id_idx" ON "console_sessions"("fleet_id", "ship_id");

-- CreateIndex
CREATE INDEX "console_sessions_fleet_id_lease_id_idx" ON "console_sessions"("fleet_id", "lease_id");

