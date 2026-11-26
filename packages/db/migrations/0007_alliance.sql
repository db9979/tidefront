CREATE TABLE "alliance" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliance_chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"alliance_id" integer NOT NULL,
	"player_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliance_member" (
	"player_id" integer PRIMARY KEY NOT NULL,
	"alliance_id" integer NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alliance_request" (
	"id" serial PRIMARY KEY NOT NULL,
	"alliance_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"kind" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diplomacy" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_a" text NOT NULL,
	"party_b" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"proposed_by" text NOT NULL,
	"active_from" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"peace_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_offer" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_id" integer NOT NULL,
	"give" text NOT NULL,
	"give_qty" integer NOT NULL,
	"want" text NOT NULL,
	"want_qty" integer NOT NULL,
	"visibility" text NOT NULL,
	"alliance_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"buyer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alliance_chat" ADD CONSTRAINT "alliance_chat_alliance_id_alliance_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_chat" ADD CONSTRAINT "alliance_chat_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_member" ADD CONSTRAINT "alliance_member_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_member" ADD CONSTRAINT "alliance_member_alliance_id_alliance_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_request" ADD CONSTRAINT "alliance_request_alliance_id_alliance_id_fk" FOREIGN KEY ("alliance_id") REFERENCES "public"."alliance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alliance_request" ADD CONSTRAINT "alliance_request_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_offer" ADD CONSTRAINT "player_offer_seller_id_player_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alliance_name_lower" ON "alliance" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "alliance_tag_lower" ON "alliance" USING btree (lower("tag"));--> statement-breakpoint
CREATE INDEX "alliance_chat_alliance" ON "alliance_chat" USING btree ("alliance_id","created_at");--> statement-breakpoint
CREATE INDEX "alliance_member_alliance" ON "alliance_member" USING btree ("alliance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alliance_request_pair" ON "alliance_request" USING btree ("alliance_id","player_id");--> statement-breakpoint
CREATE INDEX "alliance_request_player" ON "alliance_request" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diplomacy_pair" ON "diplomacy" USING btree ("party_a","party_b","kind");--> statement-breakpoint
CREATE INDEX "diplomacy_b" ON "diplomacy" USING btree ("party_b");--> statement-breakpoint
CREATE INDEX "player_offer_status" ON "player_offer" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "player_offer_seller" ON "player_offer" USING btree ("seller_id","status");