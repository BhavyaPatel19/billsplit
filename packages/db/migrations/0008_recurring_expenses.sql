CREATE TYPE "public"."recurrence_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid,
	"template" jsonb NOT NULL,
	"frequency" "recurrence_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date,
	"next_occurrence" integer DEFAULT 0 NOT NULL,
	"next_on" date NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"last_posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recurring_expenses_interval_range" CHECK ("recurring_expenses"."interval" between 1 and 12),
	CONSTRAINT "recurring_expenses_end_after_start" CHECK ("recurring_expenses"."end_on" is null or "recurring_expenses"."end_on" >= "recurring_expenses"."start_on")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_expense_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_occurrence" integer;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_expenses_group_id_idx" ON "recurring_expenses" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "recurring_expenses_due_idx" ON "recurring_expenses" USING btree ("next_on") WHERE "recurring_expenses"."deleted_at" is null and "recurring_expenses"."paused_at" is null;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_occurrence_uidx" ON "expenses" USING btree ("recurring_expense_id","recurring_occurrence") WHERE "expenses"."recurring_expense_id" is not null;