CREATE TABLE "discussion_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"mentioned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discussion_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"event_type" text,
	"event_key" text,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discussion_messages_kind_check" CHECK ("discussion_messages"."kind" in ('comment', 'event')),
	CONSTRAINT "discussion_messages_entity_type_check" CHECK ("discussion_messages"."entity_type" in ('partner', 'purchase_order', 'sales_order', 'invoice')),
	CONSTRAINT "discussion_messages_body_check" CHECK (char_length("discussion_messages"."body") between 1 and 4000),
	CONSTRAINT "discussion_messages_event_check" CHECK (("discussion_messages"."kind" = 'comment' and "discussion_messages"."event_type" is null and "discussion_messages"."event_key" is null) or ("discussion_messages"."kind" = 'event' and "discussion_messages"."event_type" is not null and "discussion_messages"."event_key" is not null)),
	CONSTRAINT "discussion_messages_event_type_check" CHECK ("discussion_messages"."event_type" is null or char_length("discussion_messages"."event_type") between 1 and 80),
	CONSTRAINT "discussion_messages_event_key_check" CHECK ("discussion_messages"."event_key" is null or char_length("discussion_messages"."event_key") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"event_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('mention', 'event')),
	CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('partner', 'purchase_order', 'sales_order', 'invoice')),
	CONSTRAINT "notifications_title_check" CHECK (char_length("notifications"."title") between 1 and 200),
	CONSTRAINT "notifications_body_check" CHECK (char_length("notifications"."body") between 1 and 500),
	CONSTRAINT "notifications_event_key_check" CHECK (char_length("notifications"."event_key") between 1 and 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_mentions_message_user_idx" ON "discussion_mentions" USING btree ("tenant_id","message_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "discussion_mentions_tenant_user_idx" ON "discussion_mentions" USING btree ("tenant_id","mentioned_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_messages_tenant_id_idx" ON "discussion_messages" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "discussion_messages_tenant_entity_idx" ON "discussion_messages" USING btree ("tenant_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_messages_tenant_event_idx" ON "discussion_messages" USING btree ("tenant_id","entity_type","entity_id","event_key") WHERE "discussion_messages"."event_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_user_event_idx" ON "notifications" USING btree ("tenant_id","user_id","event_key");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_read_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at","created_at");--> statement-breakpoint
ALTER TABLE "discussion_mentions" ADD CONSTRAINT "discussion_mentions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_mentions" ADD CONSTRAINT "discussion_mentions_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."discussion_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_mentions" ADD CONSTRAINT "discussion_mentions_tenant_user_fk" FOREIGN KEY ("tenant_id","mentioned_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_messages" ADD CONSTRAINT "discussion_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_messages" ADD CONSTRAINT "discussion_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."discussion_messages"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
