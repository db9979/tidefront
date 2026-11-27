CREATE TABLE "power_cable" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_base_id" integer,
	"to_base_id" integer,
	"from_player_id" integer NOT NULL,
	"to_player_id" integer NOT NULL,
	"status" text NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"distance_km" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"active_since" timestamp with time zone,
	"last_tick_at" timestamp with time zone,
	"delivered" double precision DEFAULT 0 NOT NULL,
	"lost" double precision DEFAULT 0 NOT NULL,
	"paid" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "power_cable" ADD CONSTRAINT "power_cable_from_base_id_base_id_fk" FOREIGN KEY ("from_base_id") REFERENCES "public"."base"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_cable" ADD CONSTRAINT "power_cable_to_base_id_base_id_fk" FOREIGN KEY ("to_base_id") REFERENCES "public"."base"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_cable" ADD CONSTRAINT "power_cable_from_player_id_player_id_fk" FOREIGN KEY ("from_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_cable" ADD CONSTRAINT "power_cable_to_player_id_player_id_fk" FOREIGN KEY ("to_player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "power_cable_from" ON "power_cable" USING btree ("from_base_id");--> statement-breakpoint
CREATE INDEX "power_cable_to" ON "power_cable" USING btree ("to_base_id");