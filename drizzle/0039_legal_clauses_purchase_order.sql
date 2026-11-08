ALTER TABLE "purchase_orders" ADD COLUMN "legal_clauses" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_legal_clauses_check" CHECK ("legal_clauses" is null or char_length("legal_clauses") <= 5000);
