CREATE TABLE "audit_run" (
	"id" serial PRIMARY KEY NOT NULL,
	"ok" integer NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"name" text NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"attacker_player_id" integer,
	"defender_player_id" integer,
	"attacker_base_id" integer,
	"defender_base_id" integer,
	"nest_id" integer,
	"winner" text,
	"seed" bigint,
	"balance_version" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_log" (
	"key" text PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"command" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"base_id" integer NOT NULL,
	"resource" text NOT NULL,
	"qty" integer NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'underway' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"base_id" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invite_code" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market" (
	"resource" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mission" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer,
	"base_id" integer,
	"type" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" integer,
	"target_col" integer NOT NULL,
	"target_row" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"status" text NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone,
	"returning" jsonb,
	"cargo_home" jsonb,
	"report_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nest" (
	"id" serial PRIMARY KEY NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"level" integer NOT NULL,
	"defeated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pass_hash" text NOT NULL,
	"trader" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"token" text PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"t_ms" bigint NOT NULL,
	"account" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(24, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wreck" (
	"id" serial PRIMARY KEY NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"stahl" double precision NOT NULL,
	"elektronik" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base" ADD CONSTRAINT "base_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission" ADD CONSTRAINT "mission_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission" ADD CONSTRAINT "mission_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "base_field" ON "base" USING btree ("col","row");--> statement-breakpoint
CREATE UNIQUE INDEX "base_player" ON "base" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "report_attacker" ON "battle_report" USING btree ("attacker_player_id","created_at");--> statement-breakpoint
CREATE INDEX "report_defender" ON "battle_report" USING btree ("defender_player_id","created_at");--> statement-breakpoint
CREATE INDEX "game_event_due" ON "game_event" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "game_event_base" ON "game_event" USING btree ("base_id","status","due_at");--> statement-breakpoint
CREATE INDEX "mission_base_status" ON "mission" USING btree ("base_id","status");--> statement-breakpoint
CREATE INDEX "mission_target" ON "mission" USING btree ("target_kind","target_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "nest_field" ON "nest" USING btree ("col","row");--> statement-breakpoint
CREATE UNIQUE INDEX "player_name_lower" ON "player" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "ledger_account" ON "trade_ledger" USING btree ("account","asset");--> statement-breakpoint
CREATE INDEX "ledger_trade" ON "trade_ledger" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "wreck_field" ON "wreck" USING btree ("col","row");