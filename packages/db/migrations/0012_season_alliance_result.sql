CREATE TABLE "season_alliance_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"alliance_id" integer,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"rank" integer NOT NULL,
	"members" integer NOT NULL,
	"total" integer NOT NULL,
	"player_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_alliance_result" ADD CONSTRAINT "season_alliance_result_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_alliance_result" ADD CONSTRAINT "season_alliance_result_alliance_id_alliance_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_alliance_result_alliance" ON "season_alliance_result" USING btree ("season_id","alliance_id");--> statement-breakpoint
CREATE INDEX "season_alliance_result_rank" ON "season_alliance_result" USING btree ("season_id","rank");