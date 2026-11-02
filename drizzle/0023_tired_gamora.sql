CREATE TABLE "hr_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"start_half_day" text NOT NULL,
	"end_half_day" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_requests_status_check" CHECK ("hr_leave_requests"."status" in ('draft', 'validated', 'refused', 'cancelled')),
	CONSTRAINT "hr_leave_requests_half_day_check" CHECK ("hr_leave_requests"."start_half_day" in ('morning', 'afternoon') and "hr_leave_requests"."end_half_day" in ('morning', 'afternoon')),
	CONSTRAINT "hr_leave_requests_dates_check" CHECK ("hr_leave_requests"."end_date" >= "hr_leave_requests"."start_date"),
	CONSTRAINT "hr_leave_requests_same_day_check" CHECK ("hr_leave_requests"."end_date" > "hr_leave_requests"."start_date" or "hr_leave_requests"."start_half_day" = 'morning' or "hr_leave_requests"."end_half_day" = 'afternoon'),
	CONSTRAINT "hr_leave_requests_reason_check" CHECK ("hr_leave_requests"."reason" is null or length(trim("hr_leave_requests"."reason")) between 1 and 200),
	CONSTRAINT "hr_leave_requests_decision_check" CHECK (("hr_leave_requests"."status" = 'draft') = ("hr_leave_requests"."decided_at" is null)),
	CONSTRAINT "hr_leave_requests_decision_note_check" CHECK ("hr_leave_requests"."decision_note" is null or length(trim("hr_leave_requests"."decision_note")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "hr_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"half_day_allowed" boolean DEFAULT true NOT NULL,
	"annual_allowance_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_leave_types_code_check" CHECK ("hr_leave_types"."code" ~ '^[A-Z0-9][A-Z0-9._-]{1,11}$'),
	CONSTRAINT "hr_leave_types_name_check" CHECK (length(trim("hr_leave_types"."name")) between 1 and 80),
	CONSTRAINT "hr_leave_types_allowance_check" CHECK ("hr_leave_types"."annual_allowance_days" >= 0 and "hr_leave_types"."annual_allowance_days" <= 366)
);
--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."hr_employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leave_types" ADD CONSTRAINT "hr_leave_types_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_leave_requests_tenant_id_idx" ON "hr_leave_requests" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_tenant_employee_idx" ON "hr_leave_requests" USING btree ("tenant_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_tenant_status_idx" ON "hr_leave_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "hr_leave_requests_tenant_dates_idx" ON "hr_leave_requests" USING btree ("tenant_id","start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_leave_types_tenant_code_idx" ON "hr_leave_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_leave_types_tenant_name_idx" ON "hr_leave_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_leave_types_tenant_id_idx" ON "hr_leave_types" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "hr_leave_requests" ADD CONSTRAINT "hr_leave_requests_tenant_type_fk" FOREIGN KEY ("tenant_id","leave_type_id") REFERENCES "public"."hr_leave_types"("tenant_id","id") ON DELETE restrict ON UPDATE no action;