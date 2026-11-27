CREATE TABLE "base_day" (
	"day" text NOT NULL,
	"base_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"bot" boolean NOT NULL,
	"season_id" integer,
	"resources" jsonb NOT NULL,
	"per_hour" jsonb NOT NULL,
	"capacity" double precision NOT NULL,
	"levels" integer NOT NULL,
	"kz" integer NOT NULL,
	"military" double precision NOT NULL,
	"credits" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_day_day_base_id_pk" PRIMARY KEY("day","base_id")
);
--> statement-breakpoint
CREATE TABLE "usage_day" (
	"day" text NOT NULL,
	"system" text NOT NULL,
	"humans" integer DEFAULT 0 NOT NULL,
	"human_uses" integer DEFAULT 0 NOT NULL,
	"bots" integer DEFAULT 0 NOT NULL,
	"bot_uses" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_day_day_system_pk" PRIMARY KEY("day","system")
);
--> statement-breakpoint
CREATE TABLE "worker_step_day" (
	"day" text NOT NULL,
	"step" text NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"total_ms" double precision DEFAULT 0 NOT NULL,
	"max_ms" double precision DEFAULT 0 NOT NULL,
	"slow" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "worker_step_day_day_step_pk" PRIMARY KEY("day","step")
);
--> statement-breakpoint
CREATE INDEX "base_day_player" ON "base_day" USING btree ("player_id","day");