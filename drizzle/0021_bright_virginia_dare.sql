CREATE TABLE "hr_public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"period" text DEFAULT 'full' NOT NULL,
	"label" text NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_public_holidays_kind_check" CHECK ("hr_public_holidays"."kind" in ('public_holiday', 'unworked')),
	CONSTRAINT "hr_public_holidays_period_check" CHECK ("hr_public_holidays"."period" in ('full', 'morning', 'afternoon')),
	CONSTRAINT "hr_public_holidays_label_check" CHECK (length(trim("hr_public_holidays"."label")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "hr_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"kind" text DEFAULT 'worked' NOT NULL,
	"period" text NOT NULL,
	"hours" numeric(18, 6),
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_time_entries_kind_check" CHECK ("hr_time_entries"."kind" in ('worked', 'absence')),
	CONSTRAINT "hr_time_entries_period_check" CHECK ("hr_time_entries"."period" in ('full', 'morning', 'afternoon', 'hours')),
	CONSTRAINT "hr_time_entries_status_check" CHECK ("hr_time_entries"."status" in ('draft', 'validated')),
	CONSTRAINT "hr_time_entries_hours_check" CHECK (("hr_time_entries"."period" = 'hours') = ("hr_time_entries"."hours" is not null) and ("hr_time_entries"."hours" is null or ("hr_time_entries"."hours" between 0.25 and 24 and "hr_time_entries"."hours" * 4 = floor("hr_time_entries"."hours" * 4)))),
	CONSTRAINT "hr_time_entries_note_check" CHECK ("hr_time_entries"."note" is null or length(trim("hr_time_entries"."note")) between 1 and 120),
	CONSTRAINT "hr_time_entries_absence_check" CHECK ("hr_time_entries"."kind" = 'worked' or length(trim("hr_time_entries"."note")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "hr_work_calendar_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"day_of_week" text NOT NULL,
	"morning_from" time,
	"morning_to" time,
	"afternoon_from" time,
	"afternoon_to" time,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_work_calendar_days_day_check" CHECK ("hr_work_calendar_days"."day_of_week" in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
	CONSTRAINT "hr_work_calendar_days_sequence_check" CHECK ("hr_work_calendar_days"."sequence" between 1 and 7),
	CONSTRAINT "hr_work_calendar_days_morning_check" CHECK (("hr_work_calendar_days"."morning_from" is null) = ("hr_work_calendar_days"."morning_to" is null) and ("hr_work_calendar_days"."morning_from" is null or "hr_work_calendar_days"."morning_from" <= "hr_work_calendar_days"."morning_to")),
	CONSTRAINT "hr_work_calendar_days_afternoon_check" CHECK (("hr_work_calendar_days"."afternoon_from" is null) = ("hr_work_calendar_days"."afternoon_to" is null) and ("hr_work_calendar_days"."afternoon_from" is null or "hr_work_calendar_days"."afternoon_from" <= "hr_work_calendar_days"."afternoon_to")),
	CONSTRAINT "hr_work_calendar_days_period_order_check" CHECK ("hr_work_calendar_days"."morning_to" is null or "hr_work_calendar_days"."afternoon_from" is null or "hr_work_calendar_days"."morning_to" <= "hr_work_calendar_days"."afternoon_from")
);
--> statement-breakpoint
CREATE TABLE "hr_work_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_work_calendars_name_check" CHECK (length(trim("hr_work_calendars"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "work_calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_public_holidays" ADD CONSTRAINT "hr_public_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_public_holidays" ADD CONSTRAINT "hr_public_holidays_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_public_holidays" ADD CONSTRAINT "hr_public_holidays_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_time_entries" ADD CONSTRAINT "hr_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_time_entries" ADD CONSTRAINT "hr_time_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_time_entries" ADD CONSTRAINT "hr_time_entries_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_time_entries" ADD CONSTRAINT "hr_time_entries_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."hr_employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_calendar_days" ADD CONSTRAINT "hr_work_calendar_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_calendars" ADD CONSTRAINT "hr_work_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_calendars" ADD CONSTRAINT "hr_work_calendars_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_work_calendars" ADD CONSTRAINT "hr_work_calendars_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_public_holidays_tenant_id_idx" ON "hr_public_holidays" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_public_holidays_tenant_date_period_idx" ON "hr_public_holidays" USING btree ("tenant_id","work_date","period");--> statement-breakpoint
CREATE INDEX "hr_public_holidays_tenant_date_idx" ON "hr_public_holidays" USING btree ("tenant_id","work_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_time_entries_tenant_id_idx" ON "hr_time_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_time_entries_tenant_period_idx" ON "hr_time_entries" USING btree ("tenant_id","employee_id","work_date","period") WHERE "hr_time_entries"."period" <> 'hours';--> statement-breakpoint
CREATE INDEX "hr_time_entries_tenant_employee_date_idx" ON "hr_time_entries" USING btree ("tenant_id","employee_id","work_date");--> statement-breakpoint
CREATE INDEX "hr_time_entries_tenant_status_idx" ON "hr_time_entries" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_calendar_days_tenant_id_idx" ON "hr_work_calendar_days" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_calendar_days_calendar_day_idx" ON "hr_work_calendar_days" USING btree ("tenant_id","calendar_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_calendars_tenant_name_idx" ON "hr_work_calendars" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_calendars_tenant_id_idx" ON "hr_work_calendars" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_work_calendars_tenant_default_idx" ON "hr_work_calendars" USING btree ("tenant_id") WHERE "hr_work_calendars"."is_default";--> statement-breakpoint
-- Une clé étrangère composée ne se pose qu'après l'index unique (tenant_id, id) de sa table cible.
ALTER TABLE "hr_work_calendar_days" ADD CONSTRAINT "hr_work_calendar_days_tenant_calendar_fk" FOREIGN KEY ("tenant_id","calendar_id") REFERENCES "public"."hr_work_calendars"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_work_calendar_fk" FOREIGN KEY ("tenant_id","work_calendar_id") REFERENCES "public"."hr_work_calendars"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks', 'customs_lines', 'customs_apurements', 'accounts', 'journal_entries', 'hr_employees', 'hr_time_entries'));