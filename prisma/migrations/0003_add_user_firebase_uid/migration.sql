ALTER TABLE "public"."users"
ADD COLUMN "firebase_uid" TEXT;

ALTER TABLE "public"."users"
ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE UNIQUE INDEX "users_firebase_uid_key"
ON "public"."users"("firebase_uid");
