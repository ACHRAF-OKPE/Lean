CREATE TABLE "article_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_unit_code" text DEFAULT 'PCE' NOT NULL,
	"default_sellable" boolean DEFAULT true NOT NULL,
	"default_purchasable" boolean DEFAULT true NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_settings_unit_check" CHECK (char_length("article_settings"."default_unit_code") between 1 and 10),
	CONSTRAINT "article_settings_usage_check" CHECK ("article_settings"."default_sellable" or "article_settings"."default_purchasable")
);
--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"due_date_offset_days" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_settings_due_offset_check" CHECK ("invoice_settings"."due_date_offset_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "nomenclature_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_tec_rate" integer,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomenclature_settings_tec_check" CHECK ("nomenclature_settings"."default_tec_rate" is null or "nomenclature_settings"."default_tec_rate" in (0, 5, 10, 20, 35))
);
--> statement-breakpoint
CREATE TABLE "partner_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_payment_term_days" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_settings_payment_term_check" CHECK ("partner_settings"."default_payment_term_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "purchase_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_receipt_delay_days" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_settings_receipt_delay_check" CHECK ("purchase_settings"."default_receipt_delay_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_delivery_delay_days" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_settings_delivery_delay_check" CHECK ("sales_settings"."default_delivery_delay_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "task_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_priority" text DEFAULT 'normal' NOT NULL,
	"default_due_in_days" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_settings_priority_check" CHECK ("task_settings"."default_priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "task_settings_due_days_check" CHECK ("task_settings"."default_due_in_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "tender_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"default_deadline_days" integer DEFAULT 7 NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_settings_deadline_check" CHECK ("tender_settings"."default_deadline_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "article_settings" ADD CONSTRAINT "article_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_settings" ADD CONSTRAINT "article_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomenclature_settings" ADD CONSTRAINT "nomenclature_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomenclature_settings" ADD CONSTRAINT "nomenclature_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_settings" ADD CONSTRAINT "task_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_settings" ADD CONSTRAINT "task_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_settings" ADD CONSTRAINT "tender_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_settings" ADD CONSTRAINT "tender_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_settings_tenant_idx" ON "article_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_settings_tenant_idx" ON "invoice_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nomenclature_settings_tenant_idx" ON "nomenclature_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_settings_tenant_idx" ON "partner_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_settings_tenant_idx" ON "purchase_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_settings_tenant_idx" ON "sales_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_settings_tenant_idx" ON "task_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_settings_tenant_idx" ON "tender_settings" USING btree ("tenant_id");