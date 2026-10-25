CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"unit_code" text NOT NULL,
	"hs_code_id" uuid,
	"sale_price_xof" integer DEFAULT 0 NOT NULL,
	"purchase_price_xof" integer DEFAULT 0 NOT NULL,
	"is_sellable" boolean DEFAULT true NOT NULL,
	"is_purchasable" boolean DEFAULT true NOT NULL,
	"country_of_origin" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_type_check" CHECK ("articles"."type" in ('product', 'service')),
	CONSTRAINT "articles_hs_check" CHECK (("articles"."type" = 'product' and "articles"."hs_code_id" is not null) or ("articles"."type" = 'service' and "articles"."hs_code_id" is null)),
	CONSTRAINT "articles_usage_check" CHECK ("articles"."is_sellable" or "articles"."is_purchasable"),
	CONSTRAINT "articles_prices_check" CHECK ("articles"."sale_price_xof" >= 0 and "articles"."purchase_price_xof" >= 0),
	CONSTRAINT "articles_origin_check" CHECK ("articles"."country_of_origin" is null or "articles"."country_of_origin" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "hs_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"wording" text NOT NULL,
	"parent_code" text,
	"supplementary_unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hs_codes_code_format_check" CHECK ("hs_codes"."code" ~ '^[0-9]{6}([0-9]{2}([0-9]{2})?)?$'),
	CONSTRAINT "hs_codes_wording_check" CHECK (char_length("hs_codes"."wording") between 1 and 240)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"sheet_name" text NOT NULL,
	"status" text DEFAULT 'analyzed' NOT NULL,
	"row_count" integer NOT NULL,
	"error_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes')),
	CONSTRAINT "import_batches_status_check" CHECK ("import_batches"."status" in ('analyzed', 'applied')),
	CONSTRAINT "import_batches_counts_check" CHECK ("import_batches"."row_count" >= 0 and "import_batches"."error_count" >= 0 and "import_batches"."warning_count" >= 0),
	CONSTRAINT "import_batches_hash_check" CHECK ("import_batches"."file_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" text NOT NULL,
	"code" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_status_check" CHECK ("import_rows"."status" in ('valid', 'warning', 'error')),
	CONSTRAINT "import_rows_row_check" CHECK ("import_rows"."row_number" > 1)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"email" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"country_code" text,
	"tax_number" text,
	"payment_term_days" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_type_check" CHECK ("partners"."type" in ('company', 'individual')),
	CONSTRAINT "partners_role_check" CHECK ("partners"."is_customer" or "partners"."is_supplier"),
	CONSTRAINT "partners_country_check" CHECK ("partners"."country_code" is null or "partners"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "partners_payment_term_check" CHECK ("partners"."payment_term_days" between 0 and 365)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "articles_tenant_code_idx" ON "articles" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "articles_tenant_name_idx" ON "articles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "articles_tenant_hs_idx" ON "articles" USING btree ("tenant_id","hs_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hs_codes_tenant_code_idx" ON "hs_codes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hs_codes_tenant_id_idx" ON "hs_codes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "hs_codes_tenant_idx" ON "hs_codes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_tenant_id_idx" ON "import_batches" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "import_batches_tenant_created_idx" ON "import_batches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_row_idx" ON "import_rows" USING btree ("batch_id","row_number");--> statement-breakpoint
CREATE INDEX "import_rows_tenant_batch_idx" ON "import_rows" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_code_idx" ON "partners" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "partners_tenant_name_idx" ON "partners" USING btree ("tenant_id","name");--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_tenant_hs_code_fk" FOREIGN KEY ("tenant_id","hs_code_id") REFERENCES "public"."hs_codes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hs_codes" ADD CONSTRAINT "hs_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_batch_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."import_batches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
