CREATE TABLE "player_activity_day" (
	"player_id" integer NOT NULL,
	"day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_activity_day_player_id_day_pk" PRIMARY KEY("player_id","day")
);
--> statement-breakpoint
CREATE TABLE "player_milestone" (
	"player_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"key" text NOT NULL,
	"reached_at" timestamp with time zone NOT NULL,
	CONSTRAINT "player_milestone_player_id_season_id_key_pk" PRIMARY KEY("player_id","season_id","key")
);
--> statement-breakpoint
CREATE TABLE "player_nudge" (
	"player_id" integer NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_nudge_player_id_key_pk" PRIMARY KEY("player_id","key")
);
--> statement-breakpoint
ALTER TABLE "morning_summary" ALTER COLUMN "enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "morning_summary" ALTER COLUMN "push" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "player_activity_day" ADD CONSTRAINT "player_activity_day_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_milestone" ADD CONSTRAINT "player_milestone_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_milestone" ADD CONSTRAINT "player_milestone_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_nudge" ADD CONSTRAINT "player_nudge_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_activity_day_day" ON "player_activity_day" USING btree ("day");--> statement-breakpoint
CREATE INDEX "player_nudge_created" ON "player_nudge" USING btree ("created_at");