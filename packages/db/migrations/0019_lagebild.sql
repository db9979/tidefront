CREATE TABLE "intel_sighting" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"object_id" integer NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "intel_sighting_key" ON "intel_sighting" USING btree ("owner","kind","object_id");--> statement-breakpoint
CREATE INDEX "intel_sighting_seen" ON "intel_sighting" USING btree ("seen_at");