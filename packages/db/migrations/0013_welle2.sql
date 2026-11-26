CREATE TABLE "admiral" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"base_id" integer NOT NULL,
	"name" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"spec1" text NOT NULL,
	"spec2" text,
	"stationed" boolean DEFAULT false NOT NULL,
	"mission_id" integer,
	"wounded_until" timestamp with time zone,
	"captive_until" timestamp with time zone,
	"battles" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "achievement_counter" (
	"player_id" integer NOT NULL,
	"counter" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_counter_player_id_counter_pk" PRIMARY KEY("player_id","counter")
);
--> statement-breakpoint
CREATE TABLE "achievement_tier" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"achievement_id" text NOT NULL,
	"tier" integer NOT NULL,
	"reward" jsonb NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_goal" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"week" text NOT NULL,
	"slot" integer NOT NULL,
	"kind" text NOT NULL,
	"param" text,
	"target" integer NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"reward" jsonb NOT NULL,
	"bonus" jsonb,
	"completed_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliance_raid" (
	"id" serial PRIMARY KEY NOT NULL,
	"alliance_id" integer NOT NULL,
	"creator_player_id" integer NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" integer NOT NULL,
	"target_col" integer NOT NULL,
	"target_row" integer NOT NULL,
	"target_name" text NOT NULL,
	"desired_arrive_at" timestamp with time zone NOT NULL,
	"join_deadline" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone,
	"status" text NOT NULL,
	"report_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliance_raid_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"raid_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"mission_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blockade" (
	"id" serial PRIMARY KEY NOT NULL,
	"mission_id" integer NOT NULL,
	"attacker_id" integer NOT NULL,
	"attacker_base_id" integer NOT NULL,
	"target_base_id" integer NOT NULL,
	"target_player_id" integer NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"units" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "convoy" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"delivery_id" text,
	"mission_id" integer,
	"sender_id" integer,
	"recipient_id" integer NOT NULL,
	"recipient_base_id" integer NOT NULL,
	"from_col" integer NOT NULL,
	"from_row" integer NOT NULL,
	"to_col" integer NOT NULL,
	"to_row" integer NOT NULL,
	"cargo" jsonb NOT NULL,
	"escort" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escort_mission_id" integer,
	"cartel_at" timestamp with time zone,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'underway' NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minefield" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"base_id" integer,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"strength" integer NOT NULL,
	"max_strength" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minefield_known" (
	"minefield_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"known_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admiral" ADD CONSTRAINT "admiral_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admiral" ADD CONSTRAINT "admiral_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_counter" ADD CONSTRAINT "achievement_counter_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_tier" ADD CONSTRAINT "achievement_tier_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_goal" ADD CONSTRAINT "weekly_goal_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_raid" ADD CONSTRAINT "alliance_raid_creator_player_id_player_id_fk" FOREIGN KEY ("creator_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_raid_member" ADD CONSTRAINT "alliance_raid_member_raid_id_alliance_raid_id_fk" FOREIGN KEY ("raid_id") REFERENCES "public"."alliance_raid"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_raid_member" ADD CONSTRAINT "alliance_raid_member_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockade" ADD CONSTRAINT "blockade_attacker_id_player_id_fk" FOREIGN KEY ("attacker_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockade" ADD CONSTRAINT "blockade_target_base_id_base_id_fk" FOREIGN KEY ("target_base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minefield" ADD CONSTRAINT "minefield_owner_id_player_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minefield" ADD CONSTRAINT "minefield_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minefield_known" ADD CONSTRAINT "minefield_known_minefield_id_minefield_id_fk" FOREIGN KEY ("minefield_id") REFERENCES "public"."minefield"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minefield_known" ADD CONSTRAINT "minefield_known_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admiral_player" ON "admiral" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "achievement_tier_unique" ON "achievement_tier" USING btree ("player_id","achievement_id","tier");--> statement-breakpoint
CREATE INDEX "achievement_tier_notify" ON "achievement_tier" USING btree ("notified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_goal_slot" ON "weekly_goal" USING btree ("player_id","week","slot");--> statement-breakpoint
CREATE INDEX "weekly_goal_open" ON "weekly_goal" USING btree ("player_id","claimed_at");--> statement-breakpoint
CREATE INDEX "alliance_raid_alliance" ON "alliance_raid" USING btree ("alliance_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "alliance_raid_member_once" ON "alliance_raid_member" USING btree ("raid_id","player_id");--> statement-breakpoint
CREATE INDEX "alliance_raid_member_player" ON "alliance_raid_member" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "blockade_target" ON "blockade" USING btree ("target_base_id","status");--> statement-breakpoint
CREATE INDEX "blockade_mission" ON "blockade" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "convoy_status" ON "convoy" USING btree ("status","arrive_at");--> statement-breakpoint
CREATE UNIQUE INDEX "convoy_delivery" ON "convoy" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "convoy_mission" ON "convoy" USING btree ("mission_id");--> statement-breakpoint
CREATE INDEX "minefield_expires" ON "minefield" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "minefield_field" ON "minefield" USING btree ("col","row");--> statement-breakpoint
CREATE UNIQUE INDEX "minefield_known_pk" ON "minefield_known" USING btree ("minefield_id","player_id");