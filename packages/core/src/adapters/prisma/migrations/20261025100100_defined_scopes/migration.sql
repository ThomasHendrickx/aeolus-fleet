-- The fleet's own scopes (decision 0046; design gateway-scopes, 4.1): one row per scope, with its one-line
-- description. A namespace holds either the fleet's scopes or one plugin's; core keeps that rule under the
-- namespace's advisory lock, as it keeps a plugin's namespace unique.
-- CreateTable
CREATE TABLE "defined_scopes" (
    "fleet_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "defined_scopes_pkey" PRIMARY KEY ("fleet_id","scope"),
    CONSTRAINT "defined_scopes_scope_check" CHECK ("scope" ~ '^[a-z][a-z0-9-]{0,31}:[a-z][a-z0-9-]{0,31}$')
);

-- AddForeignKey
ALTER TABLE "defined_scopes" ADD CONSTRAINT "defined_scopes_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
