CREATE TABLE "market_price_hour" (
	"resource" text NOT NULL,
	"hour_ms" bigint NOT NULL,
	"price" double precision NOT NULL,
	"ref" double precision NOT NULL,
	CONSTRAINT "market_price_hour_resource_hour_ms_pk" PRIMARY KEY("resource","hour_ms")
);
--> statement-breakpoint
CREATE INDEX "ledger_t" ON "trade_ledger" USING btree ("t_ms");