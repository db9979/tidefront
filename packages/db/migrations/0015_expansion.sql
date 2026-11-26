DROP INDEX "base_player";--> statement-breakpoint
ALTER TABLE "base" ADD COLUMN "is_home" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "base" SET "is_home" = true;--> statement-breakpoint
ALTER TABLE "player_offer" ADD COLUMN "seller_base_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "base_home" ON "base" USING btree ("player_id") WHERE "base"."is_home";--> statement-breakpoint
CREATE INDEX "base_player_idx" ON "base" USING btree ("player_id");