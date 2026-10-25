CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"period" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_scope_check" CHECK ("document_sequences"."scope" in ('purchase_order', 'reception', 'stock_move')),
	CONSTRAINT "document_sequences_period_check" CHECK ("document_sequences"."period" between 2000 and 9999),
	CONSTRAINT "document_sequences_value_check" CHECK ("document_sequences"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
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
	"received_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"receipt_state" text DEFAULT 'not_received' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_lines_number_check" CHECK ("purchase_order_lines"."line_number" > 0),
	CONSTRAINT "purchase_order_lines_qty_check" CHECK ("purchase_order_lines"."qty" > 0),
	CONSTRAINT "purchase_order_lines_price_check" CHECK ("purchase_order_lines"."unit_price_xof" between 0 and 2000000000),
	CONSTRAINT "purchase_order_lines_total_check" CHECK ("purchase_order_lines"."line_total_xof" between 0 and 2000000000),
	CONSTRAINT "purchase_order_lines_received_check" CHECK ("purchase_order_lines"."received_qty" >= 0),
	CONSTRAINT "purchase_order_lines_receipt_state_check" CHECK ("purchase_order_lines"."receipt_state" in ('not_received', 'partially_received', 'received'))
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"receipt_state" text DEFAULT 'not_received' NOT NULL,
	"order_date" date NOT NULL,
	"expected_receipt_date" date,
	"external_reference" text,
	"notes" text,
	"ex_tax_total" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('draft', 'requested', 'confirmed', 'closed', 'cancelled')),
	CONSTRAINT "purchase_orders_receipt_state_check" CHECK ("purchase_orders"."receipt_state" in ('not_received', 'partially_received', 'received')),
	CONSTRAINT "purchase_orders_total_check" CHECK ("purchase_orders"."ex_tax_total" between 0 and 2000000000),
	CONSTRAINT "purchase_orders_reference_check" CHECK ("purchase_orders"."external_reference" is null or char_length("purchase_orders"."external_reference") <= 60),
	CONSTRAINT "purchase_orders_number_check" CHECK ("purchase_orders"."number" is null or "purchase_orders"."number" ~ '^CMD-[0-9]{4}-[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "receptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	"received_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "receptions_status_check" CHECK ("receptions"."status" in ('validated', 'cancelled')),
	CONSTRAINT "receptions_number_check" CHECK ("receptions"."number" ~ '^REC-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "receptions_notes_check" CHECK ("receptions"."notes" is null or char_length("receptions"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"quantity" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_quantity_check" CHECK ("stock_levels"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_locations_code_format_check" CHECK ("stock_locations"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
	CONSTRAINT "stock_locations_name_check" CHECK (char_length("stock_locations"."name") between 1 and 80),
	CONSTRAINT "stock_locations_type_check" CHECK ("stock_locations"."type" in ('internal', 'supplier'))
);
--> statement-breakpoint
CREATE TABLE "stock_move_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"move_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"article_id" uuid NOT NULL,
	"purchase_order_line_id" uuid,
	"qty" numeric(18, 6) NOT NULL,
	"unit_price_xof" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_move_lines_number_check" CHECK ("stock_move_lines"."line_number" > 0),
	CONSTRAINT "stock_move_lines_qty_check" CHECK ("stock_move_lines"."qty" > 0),
	CONSTRAINT "stock_move_lines_price_check" CHECK ("stock_move_lines"."unit_price_xof" is null or "stock_move_lines"."unit_price_xof" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" text NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"partner_id" uuid,
	"purchase_order_id" uuid,
	"reception_id" uuid,
	"cancels_move_id" uuid,
	"real_date" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_moves_type_check" CHECK ("stock_moves"."type" in ('incoming', 'outgoing')),
	CONSTRAINT "stock_moves_number_check" CHECK ("stock_moves"."number" ~ '^MVT-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "stock_moves_locations_check" CHECK ("stock_moves"."from_location_id" <> "stock_moves"."to_location_id"),
	CONSTRAINT "stock_moves_notes_check" CHECK ("stock_moves"."notes" is null or char_length("stock_moves"."notes") <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_tenant_id_idx" ON "purchase_order_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "receptions_tenant_id_idx" ON "receptions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_locations_tenant_id_idx" ON "stock_locations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_moves_tenant_id_idx" ON "stock_moves" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_tenant_id_idx" ON "articles" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_id_idx" ON "partners" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_kind_check";--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_tenant_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move_lines" ADD CONSTRAINT "stock_move_lines_tenant_move_fk" FOREIGN KEY ("tenant_id","move_id") REFERENCES "public"."stock_moves"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move_lines" ADD CONSTRAINT "stock_move_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_move_lines" ADD CONSTRAINT "stock_move_lines_tenant_order_line_fk" FOREIGN KEY ("tenant_id","purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_from_location_fk" FOREIGN KEY ("tenant_id","from_location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_to_location_fk" FOREIGN KEY ("tenant_id","to_location_id") REFERENCES "public"."stock_locations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_partner_fk" FOREIGN KEY ("tenant_id","partner_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_order_fk" FOREIGN KEY ("tenant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_reception_fk" FOREIGN KEY ("tenant_id","reception_id") REFERENCES "public"."receptions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_cancels_fk" FOREIGN KEY ("tenant_id","cancels_move_id") REFERENCES "public"."stock_moves"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_tenant_scope_period_idx" ON "document_sequences" USING btree ("tenant_id","scope","period");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_order_line_idx" ON "purchase_order_lines" USING btree ("tenant_id","order_id","line_number");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_tenant_order_idx" ON "purchase_order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_number_idx" ON "purchase_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_status_idx" ON "purchase_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_supplier_idx" ON "purchase_orders" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receptions_tenant_number_idx" ON "receptions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "receptions_tenant_order_idx" ON "receptions" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_levels_tenant_location_article_idx" ON "stock_levels" USING btree ("tenant_id","location_id","article_id");--> statement-breakpoint
CREATE INDEX "stock_levels_tenant_article_idx" ON "stock_levels" USING btree ("tenant_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_locations_tenant_code_idx" ON "stock_locations" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "stock_locations_tenant_type_idx" ON "stock_locations" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_move_lines_move_line_idx" ON "stock_move_lines" USING btree ("tenant_id","move_id","line_number");--> statement-breakpoint
CREATE INDEX "stock_move_lines_tenant_move_idx" ON "stock_move_lines" USING btree ("tenant_id","move_id");--> statement-breakpoint
CREATE INDEX "stock_move_lines_tenant_article_idx" ON "stock_move_lines" USING btree ("tenant_id","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_moves_tenant_number_idx" ON "stock_moves" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "stock_moves_tenant_date_idx" ON "stock_moves" USING btree ("tenant_id","real_date");--> statement-breakpoint
CREATE INDEX "stock_moves_tenant_reception_idx" ON "stock_moves" USING btree ("tenant_id","reception_id");--> statement-breakpoint
CREATE INDEX "stock_moves_tenant_order_idx" ON "stock_moves" USING btree ("tenant_id","purchase_order_id");--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_kind_check" CHECK ("import_batches"."kind" in ('partners', 'articles', 'hs_codes', 'purchase_lines'));