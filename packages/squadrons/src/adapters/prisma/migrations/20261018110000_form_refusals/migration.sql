CREATE TABLE "form_refusals" (
    "fleet_id" TEXT NOT NULL,
    "forming_ship_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "refused_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "form_refusals_pkey" PRIMARY KEY ("fleet_id","forming_ship_id","key")
);
