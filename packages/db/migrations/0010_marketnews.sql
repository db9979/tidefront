CREATE TABLE "market_news" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"source" text NOT NULL,
	"resource" text NOT NULL,
	"pct" double precision NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"fade_minutes" integer DEFAULT 0 NOT NULL,
	"pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_news_key" ON "market_news" USING btree ("key","resource","id");--> statement-breakpoint
CREATE INDEX "market_news_ends" ON "market_news" USING btree ("ends_at");