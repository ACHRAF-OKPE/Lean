CREATE TABLE "accounting_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_journal_id" uuid NOT NULL,
	"purchase_journal_id" uuid NOT NULL,
	"bank_journal_id" uuid NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"supplier_account_id" uuid NOT NULL,
	"sales_account_id" uuid NOT NULL,
	"purchase_account_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entry_line_letterings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"code" text NOT NULL,
	"lettered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_line_letterings_code_check" CHECK ("journal_entry_line_letterings"."code" ~ '^L[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "lettering_sequences" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lettering_sequences_value_check" CHECK ("lettering_sequences"."last_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_sales_journal_fk" FOREIGN KEY ("tenant_id","sales_journal_id") REFERENCES "public"."accounting_journals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_purchase_journal_fk" FOREIGN KEY ("tenant_id","purchase_journal_id") REFERENCES "public"."accounting_journals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_bank_journal_fk" FOREIGN KEY ("tenant_id","bank_journal_id") REFERENCES "public"."accounting_journals"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_customer_account_fk" FOREIGN KEY ("tenant_id","customer_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_supplier_account_fk" FOREIGN KEY ("tenant_id","supplier_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_sales_account_fk" FOREIGN KEY ("tenant_id","sales_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_purchase_account_fk" FOREIGN KEY ("tenant_id","purchase_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_tenant_bank_account_fk" FOREIGN KEY ("tenant_id","bank_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_line_letterings" ADD CONSTRAINT "journal_entry_line_letterings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_line_letterings" ADD CONSTRAINT "journal_entry_line_letterings_lettered_by_user_id_users_id_fk" FOREIGN KEY ("lettered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_line_letterings" ADD CONSTRAINT "journal_entry_line_letterings_tenant_line_fk" FOREIGN KEY ("tenant_id","line_id") REFERENCES "public"."journal_entry_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lettering_sequences" ADD CONSTRAINT "lettering_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_settings_tenant_idx" ON "accounting_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_line_letterings_tenant_line_idx" ON "journal_entry_line_letterings" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE INDEX "journal_entry_line_letterings_tenant_code_idx" ON "journal_entry_line_letterings" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_source_idx" ON "journal_entries" USING btree ("tenant_id","source","source_id") WHERE "journal_entries"."source_id" is not null;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_check" CHECK ("journal_entries"."source" in ('manual', 'import', 'sale_invoice', 'sale_payment', 'purchase_reception', 'purchase_reception_cancel'));