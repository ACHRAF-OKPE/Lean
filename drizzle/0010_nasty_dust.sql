CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"assignee_user_id" uuid,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"created_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_title_check" CHECK (char_length("tasks"."title") between 1 and 160),
	CONSTRAINT "tasks_description_check" CHECK (char_length("tasks"."description") <= 4000),
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('open', 'in_progress', 'done', 'cancelled')),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "tasks_related_type_check" CHECK ("tasks"."related_entity_type" is null or "tasks"."related_entity_type" in ('partner', 'purchase_order', 'sales_order', 'invoice')),
	CONSTRAINT "tasks_related_pair_check" CHECK (("tasks"."related_entity_type" is null) = ("tasks"."related_entity_id" is null)),
	CONSTRAINT "tasks_completion_check" CHECK (("tasks"."status" = 'done') = ("tasks"."completed_at" is not null) and ("tasks"."completed_at" is null) = ("tasks"."completed_by_user_id" is null)),
	CONSTRAINT "tasks_revision_check" CHECK ("tasks"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "discussion_messages" DROP CONSTRAINT "discussion_messages_entity_type_check";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_entity_type_check";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_tenant_id_idx" ON "tasks" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_status_due_idx" ON "tasks" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_tenant_assignee_status_idx" ON "tasks" USING btree ("tenant_id","assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_tenant_related_idx" ON "tasks" USING btree ("tenant_id","related_entity_type","related_entity_id");--> statement-breakpoint
ALTER TABLE "discussion_messages" ADD CONSTRAINT "discussion_messages_entity_type_check" CHECK ("discussion_messages"."entity_type" in ('partner', 'purchase_order', 'sales_order', 'invoice', 'task'));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_type_check" CHECK ("notifications"."entity_type" in ('partner', 'purchase_order', 'sales_order', 'invoice', 'task'));