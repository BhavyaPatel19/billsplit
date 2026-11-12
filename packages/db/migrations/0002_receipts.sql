CREATE TYPE "public"."receipt_status" AS ENUM('awaiting_upload', 'uploaded', 'processing', 'needs_review', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"status" "receipt_status" DEFAULT 'awaiting_upload' NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_key" text NOT NULL,
	"image_key" text,
	"thumbnail_key" text,
	"ocr" jsonb,
	"ocr_cost_micro_usd" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_size_positive" CHECK ("receipts"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_participants_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_group_created_idx" ON "receipts" USING btree ("group_id","created_at");