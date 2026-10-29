CREATE TABLE "customs_apurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declaration_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"apured_at" date NOT NULL,
	"mode" text NOT NULL,
	"reference" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customs_apurements_quantity_check" CHECK ("customs_apurements"."quantity" > 0),
	CONSTRAINT "customs_apurements_mode_check" CHECK ("customs_apurements"."mode" in ('production', 'export', 'destruction', 'transfer')),
	CONSTRAINT "customs_apurements_reference_check" CHECK (char_length("customs_apurements"."reference") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "customs_regimes" ADD COLUMN "requires_apurement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customs_declaration_lines_tenant_declaration_id_idx" ON "customs_declaration_lines" USING btree ("tenant_id","declaration_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customs_apurements_tenant_id_idx" ON "customs_apurements" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "customs_apurements_tenant_declaration_idx" ON "customs_apurements" USING btree ("tenant_id","declaration_id","line_id");--> statement-breakpoint
ALTER TABLE "customs_apurements" ADD CONSTRAINT "customs_apurements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_apurements" ADD CONSTRAINT "customs_apurements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_apurements" ADD CONSTRAINT "customs_apurements_tenant_declaration_fk" FOREIGN KEY ("tenant_id","declaration_id") REFERENCES "public"."customs_declarations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customs_apurements" ADD CONSTRAINT "customs_apurements_tenant_line_fk" FOREIGN KEY ("tenant_id","declaration_id","line_id") REFERENCES "public"."customs_declaration_lines"("tenant_id","declaration_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks', 'customs_lines', 'customs_apurements'));
