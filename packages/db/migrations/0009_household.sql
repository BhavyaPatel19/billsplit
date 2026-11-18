CREATE TABLE "away_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"from_on" date NOT NULL,
	"to_on" date NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "away_periods_ordered" CHECK ("away_periods"."to_on" >= "away_periods"."from_on")
);
--> statement-breakpoint
CREATE TABLE "household_residents" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"room_weight" double precision DEFAULT 1 NOT NULL,
	"moved_in_on" date,
	"moved_out_on" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_residents_weight_nonnegative" CHECK ("household_residents"."room_weight" >= 0),
	CONSTRAINT "household_residents_out_after_in" CHECK ("household_residents"."moved_in_on" is null or "household_residents"."moved_out_on" is null or "household_residents"."moved_out_on" >= "household_residents"."moved_in_on")
);
--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "away_periods" ADD CONSTRAINT "away_periods_created_by_participants_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_residents" ADD CONSTRAINT "household_residents_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_residents" ADD CONSTRAINT "household_residents_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "away_periods_group_participant_idx" ON "away_periods" USING btree ("group_id","participant_id");--> statement-breakpoint
CREATE INDEX "household_residents_group_id_idx" ON "household_residents" USING btree ("group_id");