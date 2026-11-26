CREATE TABLE "backup_download_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"file" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"file" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "backup_download_token" ADD CONSTRAINT "backup_download_token_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_request" ADD CONSTRAINT "backup_request_requested_by_player_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_request_status" ON "backup_request" USING btree ("status","id");