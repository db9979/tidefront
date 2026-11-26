CREATE TABLE "message" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_player_id" integer,
	"to_player_id" integer NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "season_result" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"player_name" text NOT NULL,
	"rank" integer NOT NULL,
	"ausbau" integer NOT NULL,
	"militaer" integer NOT NULL,
	"kampf" integer NOT NULL,
	"beute" integer NOT NULL,
	"total" integer NOT NULL,
	"awards" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_from_player_id_player_id_fk" FOREIGN KEY ("from_player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_to_player_id_player_id_fk" FOREIGN KEY ("to_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_result" ADD CONSTRAINT "season_result_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_result" ADD CONSTRAINT "season_result_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_to" ON "message" USING btree ("to_player_id","created_at");--> statement-breakpoint
CREATE INDEX "message_from" ON "message" USING btree ("from_player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "season_number" ON "season" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "season_result_player" ON "season_result" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE INDEX "season_result_rank" ON "season_result" USING btree ("season_id","rank");