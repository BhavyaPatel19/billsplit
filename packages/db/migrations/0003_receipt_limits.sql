ALTER TABLE "receipts" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "sample_id" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_requester_created_idx" ON "receipts" USING btree ("requested_by_user_id","created_at");