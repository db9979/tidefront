CREATE TABLE "ansehen_merker" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"ki_id" integer NOT NULL,
	"kind" text NOT NULL,
	"at_ms" bigint NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ki_gesuch" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"ki_id" integer NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"resource" text NOT NULL,
	"qty" integer NOT NULL,
	"reward" jsonb NOT NULL,
	"value" integer NOT NULL,
	"contract_id" integer,
	"challenge_id" integer,
	"offered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "politik_fenster" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"slot" text NOT NULL,
	"idx" integer NOT NULL,
	"plan_kind" text,
	"good" text,
	"effect" text NOT NULL,
	"source" text DEFAULT 'plan' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seerat_sitzung" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"fenster_id" integer NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'geplant' NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"result" text,
	"tally" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seerat_stimme" (
	"sitzung_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"option" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seerat_stimme_sitzung_id_player_id_pk" PRIMARY KEY("sitzung_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "seerat_sitzung" ADD CONSTRAINT "seerat_sitzung_fenster_id_politik_fenster_id_fk" FOREIGN KEY ("fenster_id") REFERENCES "public"."politik_fenster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seerat_stimme" ADD CONSTRAINT "seerat_stimme_sitzung_id_seerat_sitzung_id_fk" FOREIGN KEY ("sitzung_id") REFERENCES "public"."seerat_sitzung"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ansehen_merker_ref" ON "ansehen_merker" USING btree ("player_id","ki_id","kind","ref");--> statement-breakpoint
CREATE INDEX "ansehen_merker_player" ON "ansehen_merker" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ki_gesuch_tag" ON "ki_gesuch" USING btree ("season_id","player_id","day");--> statement-breakpoint
CREATE INDEX "ki_gesuch_status" ON "ki_gesuch" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ki_gesuch_ki" ON "ki_gesuch" USING btree ("ki_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "politik_fenster_slot" ON "politik_fenster" USING btree ("season_id","slot","idx");--> statement-breakpoint
CREATE INDEX "politik_fenster_zeit" ON "politik_fenster" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seerat_sitzung_fenster" ON "seerat_sitzung" USING btree ("fenster_id");--> statement-breakpoint
CREATE INDEX "seerat_sitzung_zeit" ON "seerat_sitzung" USING btree ("opens_at");