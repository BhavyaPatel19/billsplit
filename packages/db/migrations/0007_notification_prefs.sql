CREATE TABLE "notification_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"activity_emails" boolean DEFAULT true NOT NULL,
	"reminder_emails" boolean DEFAULT true NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_unsubscribeToken_unique" UNIQUE("unsubscribe_token")
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;