CREATE TABLE "guide_claim" (
	"player_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"step" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"boost_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "guide_claim" ADD CONSTRAINT "guide_claim_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_claim" ADD CONSTRAINT "guide_claim_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_claim_pk" ON "guide_claim" USING btree ("player_id","season_id","step");