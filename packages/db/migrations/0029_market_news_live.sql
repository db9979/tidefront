ALTER TABLE "market_news" ADD COLUMN "effective_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "market_news_live" ON "market_news" USING btree ("effective_until");