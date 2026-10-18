-- A plugin's namespace (decision 0046): one per declaring ship, unique in the fleet,
-- with its whole list of scopes and their descriptions.
-- CreateTable
CREATE TABLE "scope_namespaces" (
    "fleet_id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "declared_by" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,

    CONSTRAINT "scope_namespaces_pkey" PRIMARY KEY ("fleet_id","namespace")
);

-- CreateIndex
CREATE UNIQUE INDEX "scope_namespaces_fleet_id_declared_by_key" ON "scope_namespaces"("fleet_id", "declared_by");

-- AddForeignKey
ALTER TABLE "scope_namespaces" ADD CONSTRAINT "scope_namespaces_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_namespaces" ADD CONSTRAINT "scope_namespaces_fleet_id_declared_by_fkey" FOREIGN KEY ("fleet_id", "declared_by") REFERENCES "ships"("fleet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
