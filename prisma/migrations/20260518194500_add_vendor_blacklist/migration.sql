CREATE TABLE "vendor_blacklist" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_blacklist_vendor_id_customer_id_key" ON "vendor_blacklist"("vendor_id", "customer_id");
CREATE INDEX "vendor_blacklist_vendor_id_idx" ON "vendor_blacklist"("vendor_id");
CREATE INDEX "vendor_blacklist_customer_id_idx" ON "vendor_blacklist"("customer_id");

ALTER TABLE "vendor_blacklist" ADD CONSTRAINT "vendor_blacklist_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_blacklist" ADD CONSTRAINT "vendor_blacklist_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_blacklist" ADD CONSTRAINT "vendor_blacklist_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
