CREATE TABLE "world_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"season_id" integer,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"target_base_id" integer,
	"units" jsonb NOT NULL,
	"initial_units" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"active_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"winner_player_id" integer,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_event_damage" (
	"event_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"hp" integer DEFAULT 0 NOT NULL,
	"loot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attacks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_event" ADD CONSTRAINT "world_event_winner_player_id_player_id_fk" FOREIGN KEY ("winner_player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_event_damage" ADD CONSTRAINT "world_event_damage_event_id_world_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."world_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_event_damage" ADD CONSTRAINT "world_event_damage_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_event_status" ON "world_event" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "world_event_target" ON "world_event" USING btree ("target_base_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "world_event_damage_pk" ON "world_event_damage" USING btree ("event_id","player_id");