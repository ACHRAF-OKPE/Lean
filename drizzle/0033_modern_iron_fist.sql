CREATE TABLE "partner_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"bank_name" text,
	"bank_country_code" text,
	"account_holder" text,
	"bank_code" text,
	"branch_code" text,
	"account_number" text,
	"rib_key" text,
	"iban" text,
	"bic" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_bank_accounts_country_check" CHECK ("partner_bank_accounts"."bank_country_code" is null or "partner_bank_accounts"."bank_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "partner_bank_accounts_bic_check" CHECK ("partner_bank_accounts"."bic" is null or "partner_bank_accounts"."bic" ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$')
);
--> statement-breakpoint
ALTER TABLE "partner_bank_accounts" ADD CONSTRAINT "partner_bank_accounts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_bank_accounts" ADD CONSTRAINT "partner_bank_accounts_tenant_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_bank_accounts_tenant_partner_idx" ON "partner_bank_accounts" USING btree ("tenant_id","partner_id");