-- DropForeignKey
ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_restaurant_id_fkey";

-- AlterTable
ALTER TABLE "public"."orders" ALTER COLUMN "restaurant_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
