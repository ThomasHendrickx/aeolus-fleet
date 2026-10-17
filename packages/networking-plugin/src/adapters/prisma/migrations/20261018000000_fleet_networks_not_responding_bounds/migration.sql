-- Common's bounds for notRespondingAfterSeconds (NETWORK_PLUGIN_NOT_RESPONDING_AFTER_MIN_SECONDS and _MAX_SECONDS).
ALTER TABLE "fleet_networks" ADD CONSTRAINT "fleet_networks_not_responding_after_bounded" CHECK (
    "not_responding_after_seconds" BETWEEN 60 AND 86400
);
