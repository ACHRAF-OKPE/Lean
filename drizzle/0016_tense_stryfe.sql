CREATE TABLE "tender_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"tender_line_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"quote_line_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"unit_price_xof" integer NOT NULL,
	"motive" text,
	"awarded_by" uuid,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_awards_qty_check" CHECK ("tender_awards"."qty" > 0),
	CONSTRAINT "tender_awards_price_check" CHECK ("tender_awards"."unit_price_xof" > 0),
	CONSTRAINT "tender_awards_motive_check" CHECK ("tender_awards"."motive" is null or char_length("tender_awards"."motive") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "tender_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"token_hash" text,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_quoted_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_invitations_status_check" CHECK ("tender_invitations"."status" in ('pending', 'sent', 'quoted', 'declined')),
	CONSTRAINT "tender_invitations_email_check" CHECK (char_length("tender_invitations"."recipient_email") between 3 and 160),
	CONSTRAINT "tender_invitations_recipient_check" CHECK ("tender_invitations"."recipient_name" is null or char_length("tender_invitations"."recipient_name") <= 120),
	CONSTRAINT "tender_invitations_token_check" CHECK (("tender_invitations"."token_hash" is null) = ("tender_invitations"."token_expires_at" is null) and ("tender_invitations"."token_hash" is null or "tender_invitations"."token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "tender_invitations_error_check" CHECK ("tender_invitations"."error_message" is null or char_length("tender_invitations"."error_message") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "tender_quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"tender_line_id" uuid NOT NULL,
	"proposed_qty" numeric(18, 6) NOT NULL,
	"unit_price_xof" integer DEFAULT 0 NOT NULL,
	"line_total_xof" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tender_quote_lines_qty_check" CHECK ("tender_quote_lines"."proposed_qty" >= 0),
	CONSTRAINT "tender_quote_lines_price_check" CHECK ("tender_quote_lines"."unit_price_xof" between 0 and 2000000000),
	CONSTRAINT "tender_quote_lines_total_check" CHECK ("tender_quote_lines"."line_total_xof" between 0 and 2000000000),
	CONSTRAINT "tender_quote_lines_coherence_check" CHECK (("tender_quote_lines"."proposed_qty" = 0 and "tender_quote_lines"."unit_price_xof" = 0) or ("tender_quote_lines"."proposed_qty" > 0 and "tender_quote_lines"."unit_price_xof" > 0))
);
--> statement-breakpoint
CREATE TABLE "tender_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"author_name" text NOT NULL,
	"author_email" text,
	"lead_time_days" integer,
	"comment" text,
	"declined" boolean DEFAULT false NOT NULL,
	"total_xof" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_quotes_revision_check" CHECK ("tender_quotes"."revision" > 0),
	CONSTRAINT "tender_quotes_author_check" CHECK (char_length("tender_quotes"."author_name") between 1 and 120),
	CONSTRAINT "tender_quotes_author_email_check" CHECK ("tender_quotes"."author_email" is null or char_length("tender_quotes"."author_email") <= 160),
	CONSTRAINT "tender_quotes_lead_time_check" CHECK ("tender_quotes"."lead_time_days" is null or "tender_quotes"."lead_time_days" between 0 and 365),
	CONSTRAINT "tender_quotes_comment_check" CHECK ("tender_quotes"."comment" is null or char_length("tender_quotes"."comment") <= 2000),
	CONSTRAINT "tender_quotes_declined_check" CHECK (not "tender_quotes"."declined" or ("tender_quotes"."comment" is not null and char_length("tender_quotes"."comment") between 1 and 2000)),
	CONSTRAINT "tender_quotes_total_check" CHECK ("tender_quotes"."total_xof" between 0 and 2000000000)
);
--> statement-breakpoint
CREATE TABLE "tender_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"article_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_code" text NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"requested_date" date,
	"note" text,
	"rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_request_lines_number_check" CHECK ("tender_request_lines"."line_number" > 0),
	CONSTRAINT "tender_request_lines_qty_check" CHECK ("tender_request_lines"."qty" > 0),
	CONSTRAINT "tender_request_lines_note_check" CHECK ("tender_request_lines"."note" is null or char_length("tender_request_lines"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "tender_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"notes" text,
	"deadline" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"sent_at" timestamp with time zone,
	"awarded_at" timestamp with time zone,
	"awarded_by" uuid,
	"orders_created_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_requests_number_check" CHECK ("tender_requests"."number" is null or "tender_requests"."number" ~ '^DAO-[0-9]{4}-[0-9]{4}$'),
	CONSTRAINT "tender_requests_title_check" CHECK (char_length("tender_requests"."title") between 1 and 120),
	CONSTRAINT "tender_requests_notes_check" CHECK ("tender_requests"."notes" is null or char_length("tender_requests"."notes") <= 2000),
	CONSTRAINT "tender_requests_status_check" CHECK ("tender_requests"."status" in ('draft', 'open', 'awarded', 'cancelled')),
	CONSTRAINT "tender_requests_sent_check" CHECK ("tender_requests"."status" = 'draft' or ("tender_requests"."number" is not null and "tender_requests"."sent_at" is not null)),
	CONSTRAINT "tender_requests_awarded_check" CHECK ("tender_requests"."status" <> 'awarded' or ("tender_requests"."awarded_at" is not null and "tender_requests"."awarded_by" is not null)),
	CONSTRAINT "tender_requests_cancelled_check" CHECK ("tender_requests"."status" <> 'cancelled' or ("tender_requests"."cancel_reason" is not null and "tender_requests"."cancelled_at" is not null and char_length("tender_requests"."cancel_reason") between 1 and 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_awards_tender_line_idx" ON "tender_awards" USING btree ("tenant_id","tender_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_awards_tenant_id_idx" ON "tender_awards" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tender_awards_tenant_tender_idx" ON "tender_awards" USING btree ("tenant_id","tender_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_invitations_tenant_tender_supplier_idx" ON "tender_invitations" USING btree ("tenant_id","tender_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_invitations_tenant_id_idx" ON "tender_invitations" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_invitations_token_idx" ON "tender_invitations" USING btree ("token_hash") WHERE "tender_invitations"."token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tender_quote_lines_quote_line_idx" ON "tender_quote_lines" USING btree ("tenant_id","quote_id","tender_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_quote_lines_tenant_id_idx" ON "tender_quote_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_quotes_invitation_revision_idx" ON "tender_quotes" USING btree ("tenant_id","invitation_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_quotes_tenant_id_idx" ON "tender_quotes" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tender_quotes_tenant_tender_idx" ON "tender_quotes" USING btree ("tenant_id","tender_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_request_lines_tender_line_idx" ON "tender_request_lines" USING btree ("tenant_id","tender_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_request_lines_tenant_id_idx" ON "tender_request_lines" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_requests_tenant_number_idx" ON "tender_requests" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_requests_tenant_id_idx" ON "tender_requests" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "tender_requests_tenant_status_idx" ON "tender_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "tender_id" uuid;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_tenant_tender_fk" FOREIGN KEY ("tenant_id","tender_id") REFERENCES "public"."tender_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_tenant_tender_line_fk" FOREIGN KEY ("tenant_id","tender_line_id") REFERENCES "public"."tender_request_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."tender_quotes"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_tenant_quote_line_fk" FOREIGN KEY ("tenant_id","quote_line_id") REFERENCES "public"."tender_quote_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_awards" ADD CONSTRAINT "tender_awards_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_invitations" ADD CONSTRAINT "tender_invitations_tenant_tender_fk" FOREIGN KEY ("tenant_id","tender_id") REFERENCES "public"."tender_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_invitations" ADD CONSTRAINT "tender_invitations_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_quote_lines" ADD CONSTRAINT "tender_quote_lines_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."tender_quotes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_quote_lines" ADD CONSTRAINT "tender_quote_lines_tenant_tender_line_fk" FOREIGN KEY ("tenant_id","tender_line_id") REFERENCES "public"."tender_request_lines"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_quotes" ADD CONSTRAINT "tender_quotes_tenant_tender_fk" FOREIGN KEY ("tenant_id","tender_id") REFERENCES "public"."tender_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_quotes" ADD CONSTRAINT "tender_quotes_tenant_invitation_fk" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."tender_invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_quotes" ADD CONSTRAINT "tender_quotes_tenant_supplier_fk" FOREIGN KEY ("tenant_id","supplier_id") REFERENCES "public"."partners"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_request_lines" ADD CONSTRAINT "tender_request_lines_tenant_tender_fk" FOREIGN KEY ("tenant_id","tender_id") REFERENCES "public"."tender_requests"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_request_lines" ADD CONSTRAINT "tender_request_lines_tenant_article_fk" FOREIGN KEY ("tenant_id","article_id") REFERENCES "public"."articles"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_requests" ADD CONSTRAINT "tender_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_requests" ADD CONSTRAINT "tender_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_requests" ADD CONSTRAINT "tender_requests_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_tender_fk" FOREIGN KEY ("tenant_id","tender_id") REFERENCES "public"."tender_requests"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_tenant_tender_idx" ON "purchase_orders" USING btree ("tenant_id","tender_id");--> statement-breakpoint
ALTER TABLE "document_sequences" DROP CONSTRAINT "document_sequences_scope_check";--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_scope_check" CHECK ("document_sequences"."scope" in ('purchase_order', 'tender', 'reception', 'stock_move', 'sales_order', 'delivery', 'invoice', 'customs_declaration', 'customs_bond'));
