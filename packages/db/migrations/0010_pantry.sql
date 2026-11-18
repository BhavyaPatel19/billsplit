CREATE TYPE "public"."pantry_run_status" AS ENUM('open', 'settled');--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "pantry_items_amount_nonnegative" CHECK ("pantry_items"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pantry_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"receipt_id" uuid,
	"description" text NOT NULL,
	"payer_id" uuid NOT NULL,
	"bought_on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"status" "pantry_run_status" DEFAULT 'open' NOT NULL,
	"expense_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pantry_runs_extras_nonnegative" CHECK ("pantry_runs"."tax_cents" >= 0 and "pantry_runs"."fee_cents" >= 0 and "pantry_runs"."discount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pantry_uses" (
	"item_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_uses_item_id_participant_id_pk" PRIMARY KEY("item_id","participant_id"),
	CONSTRAINT "pantry_uses_units_positive" CHECK ("pantry_uses"."units" > 0)
);
--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_run_id_pantry_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pantry_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_runs" ADD CONSTRAINT "pantry_runs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_runs" ADD CONSTRAINT "pantry_runs_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_runs" ADD CONSTRAINT "pantry_runs_payer_id_participants_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_runs" ADD CONSTRAINT "pantry_runs_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_runs" ADD CONSTRAINT "pantry_runs_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_uses" ADD CONSTRAINT "pantry_uses_item_id_pantry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."pantry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_uses" ADD CONSTRAINT "pantry_uses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pantry_items_run_id_idx" ON "pantry_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "pantry_runs_group_id_idx" ON "pantry_runs" USING btree ("group_id");