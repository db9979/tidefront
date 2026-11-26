CREATE TABLE "bug_report" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"screenshot" "bytea",
	"screenshot_type" text,
	"status" text DEFAULT 'offen' NOT NULL,
	"mailed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bug_report" ADD CONSTRAINT "bug_report_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_report_player" ON "bug_report" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "bug_report_status" ON "bug_report" USING btree ("status","id");