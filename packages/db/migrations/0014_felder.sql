CREATE TABLE "field_score" (
	"alliance_id" integer PRIMARY KEY NOT NULL,
	"points" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_field" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_index" integer NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	"kind" text NOT NULL,
	"tier" integer NOT NULL,
	"player_id" integer,
	"base_id" integer,
	"mission_id" integer,
	"guard" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"guard_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"last_tick_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_score" ADD CONSTRAINT "field_score_alliance_id_alliance_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_field" ADD CONSTRAINT "resource_field_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_field" ADD CONSTRAINT "resource_field_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_field_site" ON "resource_field" USING btree ("site_index");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_field_hex" ON "resource_field" USING btree ("col","row");--> statement-breakpoint
CREATE INDEX "resource_field_owner" ON "resource_field" USING btree ("player_id");