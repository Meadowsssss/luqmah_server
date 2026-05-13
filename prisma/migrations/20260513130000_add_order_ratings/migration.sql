-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN     "rating_prompt_dismissed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."order_ratings" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_ratings_order_id_key" ON "public"."order_ratings"("order_id");

-- CreateIndex
CREATE INDEX "order_ratings_restaurant_id_idx" ON "public"."order_ratings"("restaurant_id");

-- CreateIndex
CREATE INDEX "order_ratings_customer_id_idx" ON "public"."order_ratings"("customer_id");

-- AddForeignKey
ALTER TABLE "public"."order_ratings" ADD CONSTRAINT "order_ratings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_ratings" ADD CONSTRAINT "order_ratings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."order_ratings" ADD CONSTRAINT "order_ratings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
