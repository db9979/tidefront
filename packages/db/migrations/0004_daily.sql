CREATE TABLE "daily_challenge" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"day" text NOT NULL,
	"slot" integer NOT NULL,
	"kind" text NOT NULL,
	"param" text,
	"target" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"reward" jsonb NOT NULL,
	"points" integer NOT NULL,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"rerolled" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_streak" (
	"player_id" integer PRIMARY KEY NOT NULL,
	"last_day" text NOT NULL,
	"length" integer NOT NULL,
	"best" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_result" ADD COLUMN "befehle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_challenge" ADD CONSTRAINT "daily_challenge_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_streak" ADD CONSTRAINT "daily_streak_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_challenge_slot" ON "daily_challenge" USING btree ("player_id","day","slot");--> statement-breakpoint
CREATE INDEX "daily_challenge_open" ON "daily_challenge" USING btree ("player_id","claimed_at");