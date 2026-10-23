-- A ship's messages page newest first by id: those it sent, those sent to
-- it, and those it claimed as a ship of their type, each through an index
-- that reads them in that order instead of every message of the ship.
DROP INDEX "messages_fleet_id_selector_ship_id_idx";
CREATE INDEX "messages_fleet_id_selector_ship_id_id_idx" ON "messages"("fleet_id", "selector_ship_id", "id");
CREATE INDEX "messages_fleet_id_sender_ship_id_id_idx" ON "messages"("fleet_id", "sender_ship_id", "id");
CREATE INDEX "events_delivery_handed_idx" ON "events"("fleet_id", "ship_id", "message_id") WHERE ("type" = 'DeliveryHanded'::text);
