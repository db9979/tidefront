ALTER TABLE "player" ADD COLUMN "bot_profile" text;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "bot_settings" jsonb;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "bot_state" jsonb;--> statement-breakpoint
ALTER TABLE "player_offer" ADD COLUMN "escort" jsonb DEFAULT '{}'::jsonb NOT NULL;