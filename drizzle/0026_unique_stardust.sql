CREATE TABLE "payroll_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"mode" text NOT NULL,
	"amount_xof" integer DEFAULT 0 NOT NULL,
	"rate_percent" numeric(18, 6) DEFAULT '0' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_components_code_format_check" CHECK ("payroll_components"."code" ~ '^[A-Z0-9][A-Z0-9_]{1,15}$'),
	CONSTRAINT "payroll_components_label_check" CHECK (char_length("payroll_components"."label") between 1 and 80),
	CONSTRAINT "payroll_components_kind_check" CHECK ("payroll_components"."kind" in ('earning', 'deduction')),
	CONSTRAINT "payroll_components_mode_check" CHECK ("payroll_components"."mode" in ('fixed', 'percent')),
	CONSTRAINT "payroll_components_amount_check" CHECK ("payroll_components"."amount_xof" between 0 and 2000000000),
	CONSTRAINT "payroll_components_rate_check" CHECK ("payroll_components"."rate_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_day_of_month" integer DEFAULT 28 NOT NULL,
	"social_employee_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"social_employer_rate" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_settings_payment_day_check" CHECK ("payroll_settings"."payment_day_of_month" between 1 and 31),
	CONSTRAINT "payroll_settings_social_employee_check" CHECK ("payroll_settings"."social_employee_rate" between 0 and 100),
	CONSTRAINT "payroll_settings_social_employer_check" CHECK ("payroll_settings"."social_employer_rate" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "module_grants" DROP CONSTRAINT "module_grants_module_check";--> statement-breakpoint
ALTER TABLE "module_responsibles" DROP CONSTRAINT "module_responsibles_module_check";--> statement-breakpoint
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_components" ADD CONSTRAINT "payroll_components_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_components_tenant_code_idx" ON "payroll_components" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_components_tenant_id_idx" ON "payroll_components" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "payroll_components_tenant_active_idx" ON "payroll_components" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "payroll_components_tenant_kind_idx" ON "payroll_components" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_settings_tenant_idx" ON "payroll_settings" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_module_check" CHECK ("module_grants"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting', 'hr', 'payroll'));--> statement-breakpoint
ALTER TABLE "module_responsibles" ADD CONSTRAINT "module_responsibles_module_check" CHECK ("module_responsibles"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting', 'hr', 'payroll'));