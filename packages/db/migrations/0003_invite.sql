CREATE TABLE "invite_block" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_invite" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"inviter_id" integer NOT NULL,
	"channel" text NOT NULL,
	"email" text,
	"friend_name" text,
	"message" text,
	"block_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"send_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_player_id" integer
);
--> statement-breakpoint
ALTER TABLE "player_invite" ADD CONSTRAINT "player_invite_code_invite_code_code_fk" FOREIGN KEY ("code") REFERENCES "public"."invite_code"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_invite" ADD CONSTRAINT "player_invite_inviter_id_player_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_invite" ADD CONSTRAINT "player_invite_accepted_player_id_player_id_fk" FOREIGN KEY ("accepted_player_id") REFERENCES "public"."player"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_invite_code" ON "player_invite" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "player_invite_block" ON "player_invite" USING btree ("block_token");--> statement-breakpoint
CREATE INDEX "player_invite_inviter" ON "player_invite" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "player_invite_email" ON "player_invite" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "player_invite_accepted" ON "player_invite" USING btree ("accepted_player_id");