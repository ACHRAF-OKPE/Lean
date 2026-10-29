CREATE TABLE "accounting_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journals_code_check" CHECK ("accounting_journals"."code" ~ '^[A-Z0-9]{2,6}$'),
	CONSTRAINT "accounting_journals_label_check" CHECK (char_length("accounting_journals"."label") between 1 and 120),
	CONSTRAINT "accounting_journals_type_check" CHECK ("accounting_journals"."type" in ('sale', 'purchase', 'bank', 'cash', 'misc'))
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_label_check" CHECK (char_length("fiscal_years"."label") between 1 and 60),
	CONSTRAINT "fiscal_years_dates_check" CHECK ("fiscal_years"."starts_on" < "fiscal_years"."ends_on"),
	CONSTRAINT "fiscal_years_duration_check" CHECK ("fiscal_years"."ends_on" - "fiscal_years"."starts_on" <= 366),
	CONSTRAINT "fiscal_years_status_check" CHECK ("fiscal_years"."status" in ('open', 'closed')),
	CONSTRAINT "fiscal_years_closed_check" CHECK (("fiscal_years"."status" = 'closed') = ("fiscal_years"."closed_at" is not null) and ("fiscal_years"."closed_at" is null) = ("fiscal_years"."closed_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"number" text NOT NULL,
	"entry_date" date NOT NULL,
	"reference" text,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_debit" bigint DEFAULT 0 NOT NULL,
	"total_credit" bigint DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"validated_by_user_id" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_number_check" CHECK ("journal_entries"."number" ~ '^[A-Z0-9]{2,6}-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "journal_entries_label_check" CHECK (char_length("journal_entries"."label") between 1 and 160),
	CONSTRAINT "journal_entries_reference_check" CHECK ("journal_entries"."reference" is null or char_length("journal_entries"."reference") between 1 and 60),
	CONSTRAINT "journal_entries_status_check" CHECK ("journal_entries"."status" in ('draft', 'validated')),
	CONSTRAINT "journal_entries_totals_check" CHECK ("journal_entries"."total_debit" >= 0 and "journal_entries"."total_credit" >= 0 and "journal_entries"."total_debit" = "journal_entries"."total_credit"),
	CONSTRAINT "journal_entries_validated_check" CHECK (("journal_entries"."status" = 'validated') = ("journal_entries"."validated_at" is not null) and ("journal_entries"."validated_at" is null) = ("journal_entries"."validated_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "journal_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"partner_id" uuid,
	"label" text,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_lines_number_check" CHECK ("journal_entry_lines"."line_number" >= 1),
	CONSTRAINT "journal_entry_lines_label_check" CHECK ("journal_entry_lines"."label" is null or char_length("journal_entry_lines"."label") between 1 and 120),
	CONSTRAINT "journal_entry_lines_amounts_check" CHECK (("journal_entry_lines"."debit" > 0 and "journal_entry_lines"."credit" = 0) or ("journal_entry_lines"."credit" > 0 and "journal_entry_lines"."debit" = 0)),
	CONSTRAINT "journal_entry_lines_max_check" CHECK ("journal_entry_lines"."debit" between 0 and 2000000000 and "journal_entry_lines"."credit" between 0 and 2000000000)
);
--> statement-breakpoint
CREATE TABLE "journal_entry_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"period" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_sequences_period_check" CHECK ("journal_entry_sequences"."period" between 2000 and 9999),
	CONSTRAINT "journal_entry_sequences_value_check" CHECK ("journal_entry_sequences"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"account_class" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_code_check" CHECK ("ledger_accounts"."code" ~ '^[1-8][0-9]{1,9}$'),
	CONSTRAINT "ledger_accounts_label_check" CHECK (char_length("ledger_accounts"."label") between 1 and 120),
	CONSTRAINT "ledger_accounts_class_check" CHECK ("ledger_accounts"."account_class" between 1 and 8 and "ledger_accounts"."account_class" = substring("ledger_accounts"."code" from 1 for 1)::integer)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_tenant_id_idx" ON "accounting_journals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_years_tenant_id_idx" ON "fiscal_years" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_id_idx" ON "journal_entries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_id_idx" ON "ledger_accounts" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."accounting_journals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_year_fk" FOREIGN KEY ("tenant_id","fiscal_year_id") REFERENCES "public"."fiscal_years"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_tenant_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."journal_entries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_tenant_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_tenant_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_sequences" ADD CONSTRAINT "journal_entry_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_sequences" ADD CONSTRAINT "journal_entry_sequences_tenant_journal_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."accounting_journals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_tenant_code_idx" ON "accounting_journals" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "accounting_journals_tenant_type_idx" ON "accounting_journals" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "fiscal_years_tenant_range_idx" ON "fiscal_years" USING btree ("tenant_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_number_idx" ON "journal_entries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_date_idx" ON "journal_entries" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_status_idx" ON "journal_entries" USING btree ("tenant_id","status","entry_date");--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_year_idx" ON "journal_entries" USING btree ("tenant_id","fiscal_year_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_lines_tenant_entry_line_idx" ON "journal_entry_lines" USING btree ("tenant_id","entry_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_lines_tenant_id_idx" ON "journal_entry_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_tenant_entry_idx" ON "journal_entry_lines" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "journal_entry_lines_tenant_account_idx" ON "journal_entry_lines" USING btree ("tenant_id","account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_sequences_tenant_journal_period_idx" ON "journal_entry_sequences" USING btree ("tenant_id","journal_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_tenant_code_idx" ON "ledger_accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ledger_accounts_tenant_class_idx" ON "ledger_accounts" USING btree ("tenant_id","account_class","code");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks', 'customs_lines', 'customs_apurements', 'accounts', 'journal_entries'));