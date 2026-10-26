CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	"delivered_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" in ('validated', 'cancelled')),
	CONSTRAINT "deliveries_number_check" CHECK ("deliveries"."number" ~ '^BL-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "deliveries_notes_check" CHECK ("deliveries"."notes" is null or char_length("deliveries"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"order_line_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_lines_number_check" CHECK ("delivery_lines"."line_number" > 0),
	CONSTRAINT "delivery_lines_qty_check" CHECK ("delivery_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"order_line_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_code" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"unit_price_xof" integer NOT NULL,
	"line_total_xof" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_number_check" CHECK ("invoice_lines"."line_number" > 0),
	CONSTRAINT "invoice_lines_qty_check" CHECK ("invoice_lines"."qty" > 0),
	CONSTRAINT "invoice_lines_price_check" CHECK ("invoice_lines"."unit_price_xof" between 0 and 2000000000),
	CONSTRAINT "invoice_lines_total_check" CHECK ("invoice_lines"."line_total_xof" between 0 and 2000000000)
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_xof" integer NOT NULL,
	"paid_date" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_payments_amount_check" CHECK ("invoice_payments"."amount_xof" > 0),
	CONSTRAINT "invoice_payments_method_check" CHECK ("invoice_payments"."method" in ('transfer', 'cash', 'cheque', 'mobile_money')),
	CONSTRAINT "invoice_payments_reference_check" CHECK ("invoice_payments"."reference" is null or char_length("invoice_payments"."reference") <= 60)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"notes" text,
	"ex_tax_total" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'validated', 'cancelled')),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."ex_tax_total" between 0 and 2000000000),
	CONSTRAINT "invoices_dates_check" CHECK ("invoices"."due_date" >= "invoices"."invoice_date"),
	CONSTRAINT "invoices_notes_check" CHECK ("invoices"."notes" is null or char_length("invoices"."notes") <= 1000),
	CONSTRAINT "invoices_number_check" CHECK ("invoices"."number" is null or "invoices"."number" ~ '^FAC-[0-9]{4}-[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"article_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_code" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"unit_price_xof" integer NOT NULL,
	"line_total_xof" integer NOT NULL,
	"delivered_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"invoiced_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"delivery_state" text DEFAULT 'not_delivered' NOT NULL,
	"invoicing_state" text DEFAULT 'not_invoiced' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_lines_number_check" CHECK ("sales_order_lines"."line_number" > 0),
	CONSTRAINT "sales_order_lines_qty_check" CHECK ("sales_order_lines"."qty" > 0),
	CONSTRAINT "sales_order_lines_price_check" CHECK ("sales_order_lines"."unit_price_xof" between 0 and 2000000000),
	CONSTRAINT "sales_order_lines_total_check" CHECK ("sales_order_lines"."line_total_xof" between 0 and 2000000000),
	CONSTRAINT "sales_order_lines_delivered_check" CHECK ("sales_order_lines"."delivered_qty" >= 0 and "sales_order_lines"."delivered_qty" <= "sales_order_lines"."qty"),
	CONSTRAINT "sales_order_lines_invoiced_check" CHECK ("sales_order_lines"."invoiced_qty" >= 0 and "sales_order_lines"."invoiced_qty" <= "sales_order_lines"."qty"),
	CONSTRAINT "sales_order_lines_delivery_state_check" CHECK ("sales_order_lines"."delivery_state" in ('not_delivered', 'partially_delivered', 'delivered')),
	CONSTRAINT "sales_order_lines_invoicing_state_check" CHECK ("sales_order_lines"."invoicing_state" in ('not_invoiced', 'partially_invoiced', 'invoiced'))
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_state" text DEFAULT 'not_delivered' NOT NULL,
	"invoicing_state" text DEFAULT 'not_invoiced' NOT NULL,
	"order_date" date NOT NULL,
	"expected_delivery_date" date,
	"external_reference" text,
	"incoterm" text,
	"notes" text,
	"ex_tax_total" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_status_check" CHECK ("sales_orders"."status" in ('draft', 'confirmed', 'closed', 'cancelled')),
	CONSTRAINT "sales_orders_delivery_state_check" CHECK ("sales_orders"."delivery_state" in ('not_delivered', 'partially_delivered', 'delivered')),
	CONSTRAINT "sales_orders_invoicing_state_check" CHECK ("sales_orders"."invoicing_state" in ('not_invoiced', 'partially_invoiced', 'invoiced')),
	CONSTRAINT "sales_orders_total_check" CHECK ("sales_orders"."ex_tax_total" between 0 and 2000000000),
	CONSTRAINT "sales_orders_reference_check" CHECK ("sales_orders"."external_reference" is null or char_length("sales_orders"."external_reference") <= 60),
	CONSTRAINT "sales_orders_incoterm_check" CHECK ("sales_orders"."incoterm" is null or "sales_orders"."incoterm" in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
	CONSTRAINT "sales_orders_notes_check" CHECK ("sales_orders"."notes" is null or char_length("sales_orders"."notes") <= 1000),
	CONSTRAINT "sales_orders_number_check" CHECK ("sales_orders"."number" is null or "sales_orders"."number" ~ '^VTE-[0-9]{4}-[0-9]{4}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_tenant_number_idx" ON "deliveries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_tenant_id_idx" ON "deliveries" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "deliveries_tenant_order_idx" ON "deliveries" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_lines_delivery_line_idx" ON "delivery_lines" USING btree ("tenant_id","delivery_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_lines_tenant_id_idx" ON "delivery_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "delivery_lines_tenant_delivery_idx" ON "delivery_lines" USING btree ("tenant_id","delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_lines_tenant_order_line_idx" ON "delivery_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_invoice_line_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_tenant_id_idx" ON "invoice_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_order_line_idx" ON "invoice_lines" USING btree ("tenant_id","order_line_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_invoice_idx" ON "invoice_payments" USING btree ("tenant_id","invoice_id","paid_date");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_idx" ON "invoices" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_id_idx" ON "invoices" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_order_idx" ON "invoices" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_order_line_idx" ON "sales_order_lines" USING btree ("tenant_id","order_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_tenant_id_idx" ON "sales_order_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_tenant_order_idx" ON "sales_order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_tenant_number_idx" ON "sales_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_tenant_id_idx" ON "sales_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_status_idx" ON "sales_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_scope_check";--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "stock_locations" DROP CONSTRAINT "stock_locations_type_check";--> statement-breakpoint
ALTER TABLE "stock_move_lines" ADD COLUMN "sales_order_line_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "sales_order_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD COLUMN "delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_tenant_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."deliveries"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_tenant_order_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."sales_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_order_line_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."sales_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move_lines" ADD CONSTRAINT "stock_move_lines_tenant_sales_line_fk" FOREIGN KEY ("tenant_id","sales_order_line_id") REFERENCES "public"."sales_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_sales_order_fk" FOREIGN KEY ("tenant_id","sales_order_id") REFERENCES "public"."sales_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_delivery_fk" FOREIGN KEY ("tenant_id","delivery_id") REFERENCES "public"."deliveries"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_moves_tenant_sales_order_idx" ON "stock_moves" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "stock_moves_tenant_delivery_idx" ON "stock_moves" USING btree ("tenant_id","delivery_id");--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_scope_check" CHECK ("document_sequences"."scope" in ('purchase_order', 'reception', 'stock_move', 'sales_order', 'delivery', 'invoice'));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines'));--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_type_check" CHECK ("stock_locations"."type" in ('internal', 'supplier', 'customer'));--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_source_check" CHECK ("stock_moves"."purchase_order_id" is null or "stock_moves"."sales_order_id" is null);
