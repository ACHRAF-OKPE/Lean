CREATE TABLE "hr_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"trial_period_days" integer DEFAULT 0 NOT NULL,
	"weekly_hours" numeric(18, 6) DEFAULT '0' NOT NULL,
	"salary_xof" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"terminated_on" date,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_contracts_kind_check" CHECK ("hr_contracts"."kind" in ('cdi', 'cdd', 'temporary', 'internship', 'mission')),
	CONSTRAINT "hr_contracts_status_check" CHECK ("hr_contracts"."status" in ('draft', 'running', 'terminated')),
	CONSTRAINT "hr_contracts_fixed_term_check" CHECK ("hr_contracts"."kind" not in ('cdd', 'temporary', 'internship') or "hr_contracts"."end_date" is not null),
	CONSTRAINT "hr_contracts_dates_check" CHECK (("hr_contracts"."end_date" is null or "hr_contracts"."end_date" > "hr_contracts"."start_date") and ("hr_contracts"."terminated_on" is null or "hr_contracts"."terminated_on" >= "hr_contracts"."start_date")),
	CONSTRAINT "hr_contracts_termination_check" CHECK (("hr_contracts"."status" = 'terminated') = ("hr_contracts"."terminated_on" is not null)),
	CONSTRAINT "hr_contracts_trial_check" CHECK ("hr_contracts"."trial_period_days" between 0 and 365 and ("hr_contracts"."end_date" is null or "hr_contracts"."trial_period_days" <= ("hr_contracts"."end_date" - "hr_contracts"."start_date"))),
	CONSTRAINT "hr_contracts_hours_check" CHECK ("hr_contracts"."weekly_hours" between 0 and 80),
	CONSTRAINT "hr_contracts_salary_check" CHECK ("hr_contracts"."salary_xof" between 0 and 2000000000)
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"responsible_employee_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_departments_code_check" CHECK ("hr_departments"."code" ~ '^[A-Z0-9][A-Z0-9._-]{1,9}$'),
	CONSTRAINT "hr_departments_name_check" CHECK (length(trim("hr_departments"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"position" text,
	"hire_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"departure_date" date,
	"department_id" uuid,
	"manager_employee_id" uuid,
	"user_id" uuid,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employees_code_check" CHECK ("hr_employees"."code" ~ '^[A-Z0-9][A-Z0-9._/-]{0,15}$'),
	CONSTRAINT "hr_employees_names_check" CHECK (length(trim("hr_employees"."last_name")) between 1 and 60 and length(trim("hr_employees"."first_name")) between 1 and 60),
	CONSTRAINT "hr_employees_position_check" CHECK ("hr_employees"."position" is null or length(trim("hr_employees"."position")) between 1 and 80),
	CONSTRAINT "hr_employees_status_check" CHECK ("hr_employees"."status" in ('active', 'suspended', 'left')),
	CONSTRAINT "hr_employees_departure_check" CHECK (("hr_employees"."status" = 'left') = ("hr_employees"."departure_date" is not null) and ("hr_employees"."departure_date" is null or "hr_employees"."departure_date" > "hr_employees"."hire_date"))
);
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "module_grants" DROP CONSTRAINT "module_grants_module_check";--> statement-breakpoint
ALTER TABLE "module_responsibles" DROP CONSTRAINT "module_responsibles_module_check";--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contracts_tenant_id_idx" ON "hr_contracts" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_tenant_id_idx" ON "hr_departments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_tenant_id_idx" ON "hr_employees" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_contracts" ADD CONSTRAINT "hr_contracts_tenant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."hr_employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_tenant_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."hr_departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."hr_departments"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_tenant_manager_fk" FOREIGN KEY ("tenant_id","manager_employee_id") REFERENCES "public"."hr_employees"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_contracts_tenant_employee_idx" ON "hr_contracts" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "hr_contracts_tenant_status_idx" ON "hr_contracts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_contracts_tenant_employee_running_idx" ON "hr_contracts" USING btree ("tenant_id","employee_id") WHERE "hr_contracts"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_tenant_code_idx" ON "hr_departments" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_departments_tenant_name_idx" ON "hr_departments" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "hr_departments_tenant_parent_idx" ON "hr_departments" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_tenant_code_idx" ON "hr_employees" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_tenant_user_idx" ON "hr_employees" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "hr_employees_tenant_department_idx" ON "hr_employees" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE INDEX "hr_employees_tenant_status_idx" ON "hr_employees" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks', 'customs_lines', 'customs_apurements', 'accounts', 'journal_entries', 'hr_employees'));--> statement-breakpoint
ALTER TABLE "module_grants" ADD CONSTRAINT "module_grants_module_check" CHECK ("module_grants"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting', 'hr'));--> statement-breakpoint
ALTER TABLE "module_responsibles" ADD CONSTRAINT "module_responsibles_module_check" CHECK ("module_responsibles"."module" in ('partners', 'articles', 'nomenclature', 'customs', 'purchases', 'tenders', 'supply', 'exchanges', 'sales', 'invoices', 'stock', 'tasks', 'accounting', 'hr'));