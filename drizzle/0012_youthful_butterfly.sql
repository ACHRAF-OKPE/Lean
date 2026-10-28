CREATE TABLE "customs_bonds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"declaration_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"guarantee_amount" bigint NOT NULL,
	"guarantee_reference" text NOT NULL,
	"amount_at_risk" bigint NOT NULL,
	"opened_by_user_id" uuid,
	"apured_at" timestamp with time zone,
	"apured_by_user_id" uuid,
	"apurement_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_bonds_number_check" CHECK ("customs_bonds"."number" ~ '^AAC-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "customs_bonds_status_check" CHECK ("customs_bonds"."status" in ('open', 'apured')),
	CONSTRAINT "customs_bonds_guarantee_check" CHECK ("customs_bonds"."guarantee_amount" > 0),
	CONSTRAINT "customs_bonds_guarantee_reference_check" CHECK (char_length("customs_bonds"."guarantee_reference") between 1 and 120),
	CONSTRAINT "customs_bonds_amount_at_risk_check" CHECK ("customs_bonds"."amount_at_risk" >= 0),
	CONSTRAINT "customs_bonds_apurement_check" CHECK (("customs_bonds"."status" = 'apured') = ("customs_bonds"."apured_at" is not null) and ("customs_bonds"."apured_at" is null) = ("customs_bonds"."apured_by_user_id" is null) and ("customs_bonds"."status" = 'apured') = ("customs_bonds"."apurement_reference" is not null)),
	CONSTRAINT "customs_bonds_apurement_reference_check" CHECK ("customs_bonds"."apurement_reference" is null or char_length("customs_bonds"."apurement_reference") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "customs_declaration_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"hs_code_id" uuid NOT NULL,
	"hs_code" text NOT NULL,
	"designation" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_code" text NOT NULL,
	"value_xof" integer NOT NULL,
	"weight_kg" numeric(18, 3),
	"origin_country" text NOT NULL,
	"cif_value" bigint DEFAULT 0 NOT NULL,
	"duty_rate" integer,
	"duty_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_declaration_lines_number_check" CHECK ("customs_declaration_lines"."line_number" >= 1),
	CONSTRAINT "customs_declaration_lines_designation_check" CHECK (char_length("customs_declaration_lines"."designation") between 1 and 160),
	CONSTRAINT "customs_declaration_lines_quantity_check" CHECK ("customs_declaration_lines"."quantity" > 0),
	CONSTRAINT "customs_declaration_lines_value_check" CHECK ("customs_declaration_lines"."value_xof" between 0 and 2000000000),
	CONSTRAINT "customs_declaration_lines_weight_check" CHECK ("customs_declaration_lines"."weight_kg" is null or "customs_declaration_lines"."weight_kg" >= 0),
	CONSTRAINT "customs_declaration_lines_origin_check" CHECK ("customs_declaration_lines"."origin_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "customs_declaration_lines_cif_check" CHECK ("customs_declaration_lines"."cif_value" >= 0),
	CONSTRAINT "customs_declaration_lines_duty_rate_check" CHECK ("customs_declaration_lines"."duty_rate" is null or "customs_declaration_lines"."duty_rate" in (0, 5, 10, 20, 35)),
	CONSTRAINT "customs_declaration_lines_duty_check" CHECK ("customs_declaration_lines"."duty_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customs_declaration_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"base" text NOT NULL,
	"base_amount" bigint NOT NULL,
	"rate_bp" integer NOT NULL,
	"amount" bigint NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_declaration_taxes_base_check" CHECK ("customs_declaration_taxes"."base" in ('cif', 'cif_plus_duty')),
	CONSTRAINT "customs_declaration_taxes_base_amount_check" CHECK ("customs_declaration_taxes"."base_amount" >= 0),
	CONSTRAINT "customs_declaration_taxes_rate_check" CHECK ("customs_declaration_taxes"."rate_bp" between 0 and 10000),
	CONSTRAINT "customs_declaration_taxes_amount_check" CHECK ("customs_declaration_taxes"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customs_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"regime_id" uuid NOT NULL,
	"office_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"declaration_date" date NOT NULL,
	"external_reference" text,
	"freight_amount" integer DEFAULT 0 NOT NULL,
	"insurance_amount" integer DEFAULT 0 NOT NULL,
	"cif_total" bigint DEFAULT 0 NOT NULL,
	"duty_total" bigint DEFAULT 0 NOT NULL,
	"tax_total" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"paid_total" bigint DEFAULT 0 NOT NULL,
	"liquidated_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_declarations_number_check" CHECK ("customs_declarations"."number" ~ '^DEC-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "customs_declarations_status_check" CHECK ("customs_declarations"."status" in ('draft', 'deposited', 'liquidated', 'cleared', 'cancelled')),
	CONSTRAINT "customs_declarations_reference_check" CHECK ("customs_declarations"."external_reference" is null or char_length("customs_declarations"."external_reference") between 1 and 60),
	CONSTRAINT "customs_declarations_amounts_check" CHECK ("customs_declarations"."freight_amount" between 0 and 2000000000 and "customs_declarations"."insurance_amount" between 0 and 2000000000),
	CONSTRAINT "customs_declarations_totals_check" CHECK ("customs_declarations"."cif_total" >= 0 and "customs_declarations"."duty_total" >= 0 and "customs_declarations"."tax_total" >= 0 and "customs_declarations"."grand_total" >= 0 and "customs_declarations"."paid_total" >= 0 and "customs_declarations"."paid_total" <= "customs_declarations"."grand_total"),
	CONSTRAINT "customs_declarations_cleared_check" CHECK (("customs_declarations"."status" = 'cleared') = ("customs_declarations"."cleared_at" is not null)),
	CONSTRAINT "customs_declarations_cancelled_check" CHECK (("customs_declarations"."status" = 'cancelled') = ("customs_declarations"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "customs_offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_offices_code_check" CHECK ("customs_offices"."code" ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
	CONSTRAINT "customs_offices_name_check" CHECK (char_length("customs_offices"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "customs_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_at" date NOT NULL,
	"reference" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_payments_amount_check" CHECK ("customs_payments"."amount" > 0),
	CONSTRAINT "customs_payments_method_check" CHECK ("customs_payments"."method" in ('transfer', 'cash', 'cheque', 'mobile_money')),
	CONSTRAINT "customs_payments_reference_check" CHECK ("customs_payments"."reference" is null or char_length("customs_payments"."reference") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "customs_regimes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"requires_bond" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_regimes_code_check" CHECK ("customs_regimes"."code" ~ '^[A-Z0-9]{2,6}$'),
	CONSTRAINT "customs_regimes_label_check" CHECK (char_length("customs_regimes"."label") between 1 and 120),
	CONSTRAINT "customs_regimes_kind_check" CHECK ("customs_regimes"."kind" in ('import', 'export', 'suspensive', 'transit'))
);
--> statement-breakpoint
CREATE TABLE "customs_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"base" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_taxes_code_check" CHECK ("customs_taxes"."code" ~ '^[A-Z0-9]{2,6}$'),
	CONSTRAINT "customs_taxes_label_check" CHECK (char_length("customs_taxes"."label") between 1 and 120),
	CONSTRAINT "customs_taxes_base_check" CHECK ("customs_taxes"."base" in ('cif', 'cif_plus_duty')),
	CONSTRAINT "customs_taxes_rate_check" CHECK ("customs_taxes"."rate_bp" between 0 and 10000),
	CONSTRAINT "customs_taxes_position_check" CHECK ("customs_taxes"."position" between 0 and 999)
);
--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_scope_check";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "hs_codes" ADD COLUMN "tec_rate" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "customs_bonds_tenant_number_idx" ON "customs_bonds" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_bonds_tenant_declaration_idx" ON "customs_bonds" USING btree ("tenant_id","declaration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_bonds_tenant_id_idx" ON "customs_bonds" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_bonds_tenant_status_idx" ON "customs_bonds" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declaration_lines_tenant_declaration_line_idx" ON "customs_declaration_lines" USING btree ("tenant_id","declaration_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declaration_lines_tenant_id_idx" ON "customs_declaration_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declaration_taxes_tenant_declaration_code_idx" ON "customs_declaration_taxes" USING btree ("tenant_id","declaration_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declaration_taxes_tenant_id_idx" ON "customs_declaration_taxes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declarations_tenant_number_idx" ON "customs_declarations" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declarations_tenant_id_idx" ON "customs_declarations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_declarations_tenant_status_idx" ON "customs_declarations" USING btree ("tenant_id","status","declaration_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_offices_tenant_code_idx" ON "customs_offices" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_offices_tenant_id_idx" ON "customs_offices" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_offices_tenant_idx" ON "customs_offices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_payments_tenant_id_idx" ON "customs_payments" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_payments_tenant_declaration_idx" ON "customs_payments" USING btree ("tenant_id","declaration_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_regimes_tenant_code_idx" ON "customs_regimes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_regimes_tenant_id_idx" ON "customs_regimes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_regimes_tenant_idx" ON "customs_regimes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_taxes_tenant_code_idx" ON "customs_taxes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_taxes_tenant_id_idx" ON "customs_taxes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_taxes_tenant_idx" ON "customs_taxes" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "customs_bonds" ADD CONSTRAINT "customs_bonds_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bonds" ADD CONSTRAINT "customs_bonds_apured_by_user_id_users_id_fk" FOREIGN KEY ("apured_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_bonds" ADD CONSTRAINT "customs_bonds_tenant_declaration_fk" FOREIGN KEY ("tenant_id","declaration_id") REFERENCES "public"."customs_declarations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declaration_lines" ADD CONSTRAINT "customs_declaration_lines_tenant_declaration_fk" FOREIGN KEY ("tenant_id","declaration_id") REFERENCES "public"."customs_declarations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declaration_lines" ADD CONSTRAINT "customs_declaration_lines_tenant_hs_code_fk" FOREIGN KEY ("tenant_id","hs_code_id") REFERENCES "public"."hs_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declaration_taxes" ADD CONSTRAINT "customs_declaration_taxes_tenant_declaration_fk" FOREIGN KEY ("tenant_id","declaration_id") REFERENCES "public"."customs_declarations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tenant_regime_fk" FOREIGN KEY ("tenant_id","regime_id") REFERENCES "public"."customs_regimes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tenant_office_fk" FOREIGN KEY ("tenant_id","office_id") REFERENCES "public"."customs_offices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tenant_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_offices" ADD CONSTRAINT "customs_offices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_payments" ADD CONSTRAINT "customs_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_payments" ADD CONSTRAINT "customs_payments_tenant_declaration_fk" FOREIGN KEY ("tenant_id","declaration_id") REFERENCES "public"."customs_declarations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_regimes" ADD CONSTRAINT "customs_regimes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_taxes" ADD CONSTRAINT "customs_taxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_scope_check" CHECK ("document_sequences"."scope" in ('purchase_order', 'reception', 'stock_move', 'sales_order', 'delivery', 'invoice', 'customs_declaration', 'customs_bond'));--> statement-breakpoint
ALTER TABLE "hs_codes" ADD CONSTRAINT "hs_codes_tec_rate_check" CHECK ("hs_codes"."tec_rate" is null or "hs_codes"."tec_rate" in (0, 5, 10, 20, 35));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks', 'customs_lines'));