CREATE TABLE "claim_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"guests_added" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "receipt_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"participant_id" uuid NOT NULL,
	"percent_bp" integer,
	"claim_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_claims_item_participant_uq" UNIQUE("receipt_id","item_index","participant_id"),
	CONSTRAINT "receipt_claims_item_index_nonnegative" CHECK ("receipt_claims"."item_index" >= 0),
	CONSTRAINT "receipt_claims_percent_range" CHECK ("receipt_claims"."percent_bp" is null or ("receipt_claims"."percent_bp" between 1 and 10000))
);
--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_claims" ADD CONSTRAINT "receipt_claims_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_claims" ADD CONSTRAINT "receipt_claims_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_claims" ADD CONSTRAINT "receipt_claims_claim_link_id_claim_links_id_fk" FOREIGN KEY ("claim_link_id") REFERENCES "public"."claim_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_links_receipt_id_idx" ON "claim_links" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_claims_participant_id_idx" ON "receipt_claims" USING btree ("participant_id");