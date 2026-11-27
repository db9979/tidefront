CREATE TABLE "season_finale_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"total_hp" integer NOT NULL,
	"destroyed_hp" integer NOT NULL,
	"players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alliances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"champion_player_id" integer,
	"champion_name" text,
	"fleet_name" text,
	"fleet_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_finale_result" ADD CONSTRAINT "season_finale_result_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_finale_result" ADD CONSTRAINT "season_finale_result_champion_player_id_player_id_fk" FOREIGN KEY ("champion_player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_finale_result_season" ON "season_finale_result" USING btree ("season_id");