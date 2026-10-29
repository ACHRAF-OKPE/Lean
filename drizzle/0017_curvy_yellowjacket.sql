CREATE TABLE "article_supply_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"safety_delay_days" integer DEFAULT 0 NOT NULL,
	"min_stock_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"reorder_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"order_multiple_qty" numeric(18, 6),
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_supply_policies_lead_time_check" CHECK ("article_supply_policies"."lead_time_days" between 0 and 365),
	CONSTRAINT "article_supply_policies_safety_delay_check" CHECK ("article_supply_policies"."safety_delay_days" between 0 and 60),
	CONSTRAINT "article_supply_policies_quantities_check" CHECK ("article_supply_policies"."min_stock_qty" >= 0 and "article_supply_policies"."reorder_qty" >= 0 and ("article_supply_policies"."order_multiple_qty" is null or "article_supply_policies"."order_multiple_qty" > 0))
);
--> statement-breakpoint
CREATE TABLE "supply_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"horizon_days" integer NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"proposal_count" integer DEFAULT 0 NOT NULL,
	"calculated_by" uuid,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_runs_number_check" CHECK ("supply_runs"."number" ~ '^BES-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "supply_runs_horizon_check" CHECK ("supply_runs"."horizon_days" between 1 and 365),
	CONSTRAINT "supply_runs_counts_check" CHECK ("supply_runs"."line_count" >= 0 and "supply_runs"."proposal_count" >= 0 and "supply_runs"."proposal_count" <= "supply_runs"."line_count")
);
--> statement-breakpoint
CREATE TABLE "supply_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"article_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"stock_qty" numeric(18, 6) NOT NULL,
	"incoming_qty" numeric(18, 6) NOT NULL,
	"outgoing_qty" numeric(18, 6) NOT NULL,
	"min_stock_qty" numeric(18, 6) NOT NULL,
	"reorder_qty" numeric(18, 6) NOT NULL,
	"projected_qty" numeric(18, 6) NOT NULL,
	"proposed_qty" numeric(18, 6) NOT NULL,
	"purchase_price_xof" integer DEFAULT 0 NOT NULL,
	"need_date" date NOT NULL,
	"order_date" date NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decision_reason" text,
	"converted_document_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supply_run_lines_number_check" CHECK ("supply_run_lines"."line_number" > 0),
	CONSTRAINT "supply_run_lines_quantities_check" CHECK ("supply_run_lines"."stock_qty" >= 0 and "supply_run_lines"."incoming_qty" >= 0 and "supply_run_lines"."outgoing_qty" >= 0 and "supply_run_lines"."min_stock_qty" >= 0 and "supply_run_lines"."reorder_qty" >= 0 and "supply_run_lines"."proposed_qty" > 0),
	CONSTRAINT "supply_run_lines_price_check" CHECK ("supply_run_lines"."purchase_price_xof" between 0 and 2000000000),
	CONSTRAINT "supply_run_lines_decision_check" CHECK ("supply_run_lines"."decision" in ('pending', 'ordered', 'tendered', 'dismissed')),
	CONSTRAINT "supply_run_lines_decided_check" CHECK ("supply_run_lines"."decision" = 'pending' or ("supply_run_lines"."decided_at" is not null and "supply_run_lines"."decided_by" is not null)),
	CONSTRAINT "supply_run_lines_dismissed_check" CHECK ("supply_run_lines"."decision" <> 'dismissed' or ("supply_run_lines"."decision_reason" is not null and char_length("supply_run_lines"."decision_reason") between 1 and 500)),
	CONSTRAINT "supply_run_lines_converted_check" CHECK ("supply_run_lines"."decision" not in ('ordered', 'tendered') or "supply_run_lines"."converted_document_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_scope_check";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supply_run_id" uuid;--> statement-breakpoint
ALTER TABLE "tender_requests" ADD COLUMN "supply_run_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "article_supply_policies_tenant_article_idx" ON "article_supply_policies" USING btree ("tenant_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_supply_policies_tenant_id_idx" ON "article_supply_policies" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "article_supply_policies_tenant_supplier_idx" ON "article_supply_policies" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_runs_tenant_number_idx" ON "supply_runs" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_runs_tenant_id_idx" ON "supply_runs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "supply_runs_tenant_calculated_idx" ON "supply_runs" USING btree ("tenant_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_run_lines_run_line_idx" ON "supply_run_lines" USING btree ("tenant_id","run_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "supply_run_lines_tenant_id_idx" ON "supply_run_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "supply_run_lines_tenant_run_idx" ON "supply_run_lines" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supply_run_idx" ON "purchase_orders" USING btree ("tenant_id","supply_run_id");--> statement-breakpoint
CREATE INDEX "tender_requests_tenant_supply_run_idx" ON "tender_requests" USING btree ("tenant_id","supply_run_id");--> statement-breakpoint
ALTER TABLE "article_supply_policies" ADD CONSTRAINT "article_supply_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_supply_policies" ADD CONSTRAINT "article_supply_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_supply_policies" ADD CONSTRAINT "article_supply_policies_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_supply_policies" ADD CONSTRAINT "article_supply_policies_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_runs" ADD CONSTRAINT "supply_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_runs" ADD CONSTRAINT "supply_runs_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_run_lines" ADD CONSTRAINT "supply_run_lines_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_run_lines" ADD CONSTRAINT "supply_run_lines_tenant_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."supply_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_run_lines" ADD CONSTRAINT "supply_run_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_run_lines" ADD CONSTRAINT "supply_run_lines_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_supply_run_fk" FOREIGN KEY ("tenant_id","supply_run_id") REFERENCES "public"."supply_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_requests" ADD CONSTRAINT "tender_requests_tenant_supply_run_fk" FOREIGN KEY ("tenant_id","supply_run_id") REFERENCES "public"."supply_runs"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_scope_check" CHECK ("document_sequences"."scope" in ('purchase_order', 'tender', 'supply_run', 'reception', 'stock_move', 'sales_order', 'delivery', 'invoice', 'customs_declaration', 'customs_bond'));
