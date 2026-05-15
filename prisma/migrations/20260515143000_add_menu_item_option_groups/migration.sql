-- CreateEnum
CREATE TYPE "public"."OptionSelectionType" AS ENUM ('SINGLE', 'MULTIPLE');

-- CreateTable
CREATE TABLE "public"."menu_item_option_groups" (
    "id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "selection_type" "public"."OptionSelectionType" NOT NULL DEFAULT 'MULTIPLE',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_option_groups_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "public"."menu_item_customizations" ADD COLUMN "option_group_id" TEXT;
ALTER TABLE "public"."menu_item_customizations" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "menu_item_option_groups_menu_item_id_idx" ON "public"."menu_item_option_groups"("menu_item_id");
CREATE INDEX "menu_item_customizations_option_group_id_idx" ON "public"."menu_item_customizations"("option_group_id");

-- Backfill flat customizations into a default optional multi-select group
INSERT INTO "public"."menu_item_option_groups" (
    "id",
    "menu_item_id",
    "title",
    "selection_type",
    "is_required",
    "sort_order",
    "created_at",
    "updated_at"
)
SELECT DISTINCT
    CONCAT('migrated_group_', "menu_item_id"),
    "menu_item_id",
    'Options',
    'MULTIPLE'::"public"."OptionSelectionType",
    false,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "public"."menu_item_customizations";

UPDATE "public"."menu_item_customizations"
SET "option_group_id" = CONCAT('migrated_group_', "menu_item_id")
WHERE "option_group_id" IS NULL;

ALTER TABLE "public"."menu_item_customizations"
ALTER COLUMN "option_group_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."menu_item_customizations" ADD CONSTRAINT "menu_item_customizations_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "public"."menu_item_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
