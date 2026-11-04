CREATE TABLE "payroll_payslip_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"component_id" uuid,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"rate_percent" numeric(18, 6) DEFAULT '0' NOT NULL,
	"amount_xof" integer DEFAULT 0 NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payslip_lines_kind_check" CHECK ("payroll_payslip_lines"."kind" in ('earning', 'deduction')),
	CONSTRAINT "payroll_payslip_lines_mode_check" CHECK ("payroll_payslip_lines"."mode" in ('fixed', 'percent')),
	CONSTRAINT "payroll_payslip_lines_amount_check" CHECK ("payroll_payslip_lines"."amount_xof" between 0 and 2000000000),
	CONSTRAINT "payroll_payslip_lines_rate_check" CHECK ("payroll_payslip_lines"."rate_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "payroll_payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"base_salary_xof" integer DEFAULT 0 NOT NULL,
	"gross_xof" integer DEFAULT 0 NOT NULL,
	"social_employee_xof" integer DEFAULT 0 NOT NULL,
	"social_employer_xof" integer DEFAULT 0 NOT NULL,
	"deductions_xof" integer DEFAULT 0 NOT NULL,
	"net_xof" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payslips_status_check" CHECK ("payroll_payslips"."status" in ('draft', 'validated')),
	CONSTRAINT "payroll_payslips_validation_check" CHECK (("payroll_payslips"."status" = 'validated') = ("payroll_payslips"."validated_at" is not null) and ("payroll_payslips"."validated_at" is null) = ("payroll_payslips"."validated_by_user_id" is null)),
	CONSTRAINT "payroll_payslips_amounts_check" CHECK ("payroll_payslips"."base_salary_xof" between 0 and 2000000000 and "payroll_payslips"."gross_xof" between 0 and 2000000000 and "payroll_payslips"."social_employee_xof" between 0 and 2000000000 and "payroll_payslips"."social_employer_xof" between 0 and 2000000000 and "payroll_payslips"."deductions_xof" between 0 and 2000000000 and "payroll_payslips"."net_xof" between 0 and 2000000000),
	CONSTRAINT "payroll_payslips_net_check" CHECK ("payroll_payslips"."net_xof" = "payroll_payslips"."gross_xof" - "payroll_payslips"."social_employee_xof" - "payroll_payslips"."deductions_xof")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payslips_tenant_id_idx" ON "payroll_payslips" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "payroll_payslip_lines" ADD CONSTRAINT "payroll_payslip_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslip_lines" ADD CONSTRAINT "payroll_payslip_lines_component_id_payroll_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."payroll_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslip_lines" ADD CONSTRAINT "payroll_payslip_lines_tenant_payslip_fk" FOREIGN KEY ("tenant_id","payslip_id") REFERENCES "public"."payroll_payslips"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_tenant_period_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "public"."payroll_periods"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."hr_employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payslips" ADD CONSTRAINT "payroll_payslips_tenant_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."hr_contracts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payslip_lines_tenant_id_idx" ON "payroll_payslip_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payroll_payslip_lines_tenant_payslip_idx" ON "payroll_payslip_lines" USING btree ("tenant_id","payslip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payslips_tenant_period_employee_idx" ON "payroll_payslips" USING btree ("tenant_id","period_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_payslips_tenant_period_idx" ON "payroll_payslips" USING btree ("tenant_id","period_id");--> statement-breakpoint
CREATE INDEX "payroll_payslips_tenant_employee_idx" ON "payroll_payslips" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_payslips_tenant_status_idx" ON "payroll_payslips" USING btree ("tenant_id","status");