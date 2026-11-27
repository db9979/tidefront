CREATE TABLE "radar_post" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"base_id" integer NOT NULL,
	"mission_id" integer,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"field_id" integer,
	"crew" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"offline" boolean DEFAULT false NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radar_post" ADD CONSTRAINT "radar_post_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_post" ADD CONSTRAINT "radar_post_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radar_post_player" ON "radar_post" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_post_hex" ON "radar_post" USING btree ("col","row");