CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_periods_year_check" CHECK ("payroll_periods"."year" between 2000 and 2100),
	CONSTRAINT "payroll_periods_month_check" CHECK ("payroll_periods"."month" between 1 and 12),
	CONSTRAINT "payroll_periods_status_check" CHECK ("payroll_periods"."status" in ('draft', 'validated')),
	CONSTRAINT "payroll_periods_validation_check" CHECK (("payroll_periods"."status" = 'validated') = ("payroll_periods"."validated_at" is not null) and ("payroll_periods"."validated_at" is null) = ("payroll_periods"."validated_by_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_tenant_year_month_idx" ON "payroll_periods" USING btree ("tenant_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_periods_tenant_id_idx" ON "payroll_periods" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payroll_periods_tenant_status_idx" ON "payroll_periods" USING btree ("tenant_id","status");