ALTER TABLE "purchase_orders" ADD COLUMN "supplier_invoice_number" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_invoice_date" date;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "supplier_invoice_amount_xof" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "matching_status" text DEFAULT 'unmatched' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "matching_lines" jsonb;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "matched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "matched_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "dispute_notes" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_matching_status_check" CHECK ("purchase_orders"."matching_status" in ('unmatched', 'matched', 'quantity_mismatch', 'price_mismatch', 'pending_receipt', 'disputed'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_invoice_check" CHECK ("purchase_orders"."supplier_invoice_number" is null or char_length("purchase_orders"."supplier_invoice_number") <= 80);