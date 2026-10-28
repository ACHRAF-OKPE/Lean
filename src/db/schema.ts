import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "member">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_idx").on(table.tenantId, table.userId),
    index("memberships_user_idx").on(table.userId),
    check("memberships_role_check", sql`${table.role} in ('owner', 'admin', 'member')`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_tenant_idx").on(table.tenantId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_tenant_created_idx").on(table.tenantId, table.createdAt)],
);

export const companySettings = pgTable(
  "company_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    legalForm: text("legal_form"),
    capitalXof: integer("capital_xof"),
    taxId: text("tax_id"),
    rccm: text("rccm"),
    addressLine: text("address_line"),
    city: text("city"),
    postalCode: text("postal_code"),
    countryCode: text("country_code"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    logoData: bytea("logo_data"),
    logoMime: text("logo_mime"),
    invoiceFooter: text("invoice_footer"),
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    defaultIncoterm: text("default_incoterm"),
    bankName: text("bank_name"),
    bankAccountHolder: text("bank_account_holder"),
    bankAccountNumber: text("bank_account_number"),
    bankSwift: text("bank_swift"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("company_settings_tenant_idx").on(table.tenantId),
    check(
      "company_settings_legal_name_check",
      sql`char_length(${table.legalName}) between 1 and 160`,
    ),
    check(
      "company_settings_legal_form_check",
      sql`${table.legalForm} is null or char_length(${table.legalForm}) <= 120`,
    ),
    check(
      "company_settings_capital_check",
      sql`${table.capitalXof} is null or ${table.capitalXof} between 0 and 2000000000`,
    ),
    check(
      "company_settings_tax_id_check",
      sql`${table.taxId} is null or char_length(${table.taxId}) <= 40`,
    ),
    check(
      "company_settings_rccm_check",
      sql`${table.rccm} is null or char_length(${table.rccm}) <= 40`,
    ),
    check(
      "company_settings_address_check",
      sql`${table.addressLine} is null or char_length(${table.addressLine}) <= 200`,
    ),
    check(
      "company_settings_city_check",
      sql`${table.city} is null or char_length(${table.city}) <= 80`,
    ),
    check(
      "company_settings_postal_check",
      sql`${table.postalCode} is null or char_length(${table.postalCode}) <= 16`,
    ),
    check(
      "company_settings_country_check",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check(
      "company_settings_email_check",
      sql`${table.email} is null or char_length(${table.email}) <= 160`,
    ),
    check(
      "company_settings_phone_check",
      sql`${table.phone} is null or char_length(${table.phone}) <= 30`,
    ),
    check(
      "company_settings_website_check",
      sql`${table.website} is null or char_length(${table.website}) <= 200`,
    ),
    check(
      "company_settings_logo_check",
      sql`(${table.logoData} is null) = (${table.logoMime} is null) and (${table.logoMime} is null or ${table.logoMime} in ('image/png', 'image/jpeg', 'image/webp'))`,
    ),
    check(
      "company_settings_footer_check",
      sql`${table.invoiceFooter} is null or char_length(${table.invoiceFooter}) <= 500`,
    ),
    check("company_settings_payment_term_check", sql`${table.paymentTermDays} between 0 and 365`),
    check(
      "company_settings_incoterm_check",
      sql`${table.defaultIncoterm} is null or ${table.defaultIncoterm} in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')`,
    ),
    check(
      "company_settings_bank_check",
      sql`(${table.bankName} is null and ${table.bankAccountHolder} is null and ${table.bankAccountNumber} is null) or (${table.bankName} is not null and ${table.bankAccountHolder} is not null and ${table.bankAccountNumber} is not null)`,
    ),
    check(
      "company_settings_bank_length_check",
      sql`(${table.bankName} is null or char_length(${table.bankName}) <= 80) and (${table.bankAccountHolder} is null or char_length(${table.bankAccountHolder}) <= 120) and (${table.bankAccountNumber} is null or char_length(${table.bankAccountNumber}) <= 34) and (${table.bankSwift} is null or char_length(${table.bankSwift}) <= 11)`,
    ),
  ],
);

export type PartnerType = "company" | "individual";
export type ArticleType = "product" | "service";
export type ImportKind =
  "partners" | "articles" | "hs_codes" | "purchase_lines" | "sales_lines" | "tasks";
export type ImportBatchStatus = "analyzed" | "applied";
export type ImportRowStatus = "valid" | "warning" | "error";
export type PurchaseOrderStatus = "draft" | "requested" | "confirmed" | "closed" | "cancelled";
export type ReceiptState = "not_received" | "partially_received" | "received";
export type ReceptionStatus = "validated" | "cancelled";
export type SalesOrderStatus = "draft" | "confirmed" | "closed" | "cancelled";
export type DeliveryState = "not_delivered" | "partially_delivered" | "delivered";
export type InvoicingState = "not_invoiced" | "partially_invoiced" | "invoiced";
export type DeliveryStatus = "validated" | "cancelled";
export type InvoiceStatus = "draft" | "validated" | "cancelled";
export type PaymentMethod = "transfer" | "cash" | "cheque" | "mobile_money";
export type StockLocationType = "internal" | "supplier" | "customer";
export type StockMoveType = "incoming" | "outgoing";
export type DocumentScope =
  "purchase_order" | "reception" | "stock_move" | "sales_order" | "delivery" | "invoice";
export type EmailSecurity = "tls" | "starttls" | "none";
export type ExchangeType = "purchase_request" | "purchase_confirmation";
export type ExchangeMessageStatus = "sent" | "failed";
export type SupplierReplyAvailability = "available" | "partial" | "unavailable";

export const hsCodes = pgTable(
  "hs_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    wording: text("wording").notNull(),
    parentCode: text("parent_code"),
    supplementaryUnit: text("supplementary_unit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("hs_codes_tenant_code_idx").on(table.tenantId, table.code),
    uniqueIndex("hs_codes_tenant_id_idx").on(table.tenantId, table.id),
    index("hs_codes_tenant_idx").on(table.tenantId),
    check("hs_codes_code_format_check", sql`${table.code} ~ '^[0-9]{6}([0-9]{2}([0-9]{2})?)?$'`),
    check("hs_codes_wording_check", sql`char_length(${table.wording}) between 1 and 240`),
  ],
);

export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<PartnerType>().notNull(),
    isCustomer: boolean("is_customer").notNull().default(false),
    isSupplier: boolean("is_supplier").notNull().default(false),
    email: text("email"),
    phone: text("phone"),
    addressLine: text("address_line"),
    city: text("city"),
    countryCode: text("country_code"),
    taxNumber: text("tax_number"),
    paymentTermDays: integer("payment_term_days").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("partners_tenant_code_idx").on(table.tenantId, table.code),
    uniqueIndex("partners_tenant_id_idx").on(table.tenantId, table.id),
    index("partners_tenant_name_idx").on(table.tenantId, table.name),
    check("partners_type_check", sql`${table.type} in ('company', 'individual')`),
    check("partners_role_check", sql`${table.isCustomer} or ${table.isSupplier}`),
    check(
      "partners_country_check",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check("partners_payment_term_check", sql`${table.paymentTermDays} between 0 and 365`),
  ],
);

export const partnerContacts = pgTable(
  "partner_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    partnerId: uuid("partner_id").notNull(),
    fullName: text("full_name").notNull(),
    jobTitle: text("job_title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("partner_contacts_tenant_partner_idx").on(table.tenantId, table.partnerId),
    uniqueIndex("partner_contacts_primary_idx")
      .on(table.tenantId, table.partnerId)
      .where(sql`${table.isPrimary}`),
    check(
      "partner_contacts_full_name_check",
      sql`char_length(${table.fullName}) between 1 and 120`,
    ),
    check(
      "partner_contacts_job_title_check",
      sql`${table.jobTitle} is null or char_length(${table.jobTitle}) <= 80`,
    ),
    check(
      "partner_contacts_email_check",
      sql`${table.email} is null or char_length(${table.email}) <= 160`,
    ),
    check(
      "partner_contacts_phone_check",
      sql`${table.phone} is null or char_length(${table.phone}) <= 30`,
    ),
    check("partner_contacts_primary_active_check", sql`not ${table.isPrimary} or ${table.active}`),
    foreignKey({
      name: "partner_contacts_tenant_partner_fk",
      columns: [table.tenantId, table.partnerId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("cascade"),
  ],
);

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    security: text("security").$type<EmailSecurity>().notNull(),
    username: text("username"),
    passwordCiphertext: text("password_ciphertext"),
    fromName: text("from_name").notNull(),
    fromAddress: text("from_address").notNull(),
    replyTo: text("reply_to"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_accounts_tenant_idx").on(table.tenantId),
    uniqueIndex("email_accounts_tenant_id_idx").on(table.tenantId, table.id),
    check("email_accounts_name_check", sql`char_length(${table.name}) between 1 and 80`),
    check("email_accounts_host_check", sql`char_length(${table.host}) between 1 and 255`),
    check("email_accounts_port_check", sql`${table.port} between 1 and 65535`),
    check("email_accounts_security_check", sql`${table.security} in ('tls', 'starttls', 'none')`),
    check(
      "email_accounts_credentials_check",
      sql`(${table.username} is null) = (${table.passwordCiphertext} is null)`,
    ),
    check("email_accounts_from_name_check", sql`char_length(${table.fromName}) between 1 and 120`),
    check(
      "email_accounts_from_address_check",
      sql`char_length(${table.fromAddress}) between 3 and 160`,
    ),
    check(
      "email_accounts_reply_to_check",
      sql`${table.replyTo} is null or char_length(${table.replyTo}) <= 160`,
    ),
  ],
);

export const exchangeTemplates = pgTable(
  "exchange_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<ExchangeType>().notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("exchange_templates_tenant_name_idx").on(table.tenantId, table.name),
    uniqueIndex("exchange_templates_tenant_id_idx").on(table.tenantId, table.id),
    uniqueIndex("exchange_templates_default_idx")
      .on(table.tenantId, table.type)
      .where(sql`${table.isDefault}`),
    index("exchange_templates_tenant_type_idx").on(table.tenantId, table.type, table.active),
    check(
      "exchange_templates_type_check",
      sql`${table.type} in ('purchase_request', 'purchase_confirmation')`,
    ),
    check("exchange_templates_name_check", sql`char_length(${table.name}) between 1 and 120`),
    check("exchange_templates_subject_check", sql`char_length(${table.subject}) between 1 and 200`),
    check("exchange_templates_body_check", sql`char_length(${table.body}) between 1 and 6000`),
    check(
      "exchange_templates_default_active_check",
      sql`not ${table.isDefault} or ${table.active}`,
    ),
  ],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").$type<ArticleType>().notNull(),
    unitCode: text("unit_code").notNull(),
    hsCodeId: uuid("hs_code_id"),
    salePriceXof: integer("sale_price_xof").notNull().default(0),
    purchasePriceXof: integer("purchase_price_xof").notNull().default(0),
    isSellable: boolean("is_sellable").notNull().default(true),
    isPurchasable: boolean("is_purchasable").notNull().default(true),
    countryOfOrigin: text("country_of_origin"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("articles_tenant_code_idx").on(table.tenantId, table.code),
    uniqueIndex("articles_tenant_id_idx").on(table.tenantId, table.id),
    index("articles_tenant_name_idx").on(table.tenantId, table.name),
    index("articles_tenant_hs_idx").on(table.tenantId, table.hsCodeId),
    check("articles_type_check", sql`${table.type} in ('product', 'service')`),
    check(
      "articles_hs_check",
      sql`(${table.type} = 'product' and ${table.hsCodeId} is not null) or (${table.type} = 'service' and ${table.hsCodeId} is null)`,
    ),
    check("articles_usage_check", sql`${table.isSellable} or ${table.isPurchasable}`),
    check(
      "articles_prices_check",
      sql`${table.salePriceXof} >= 0 and ${table.purchasePriceXof} >= 0`,
    ),
    check(
      "articles_origin_check",
      sql`${table.countryOfOrigin} is null or ${table.countryOfOrigin} ~ '^[A-Z]{2}$'`,
    ),
    foreignKey({
      name: "articles_tenant_hs_code_fk",
      columns: [table.tenantId, table.hsCodeId],
      foreignColumns: [hsCodes.tenantId, hsCodes.id],
    }).onDelete("restrict"),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ImportKind>().notNull(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    sheetName: text("sheet_name").notNull(),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    status: text("status").$type<ImportBatchStatus>().notNull().default("analyzed"),
    rowCount: integer("row_count").notNull(),
    errorCount: integer("error_count").notNull(),
    warningCount: integer("warning_count").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("import_batches_tenant_id_idx").on(table.tenantId, table.id),
    index("import_batches_tenant_created_idx").on(table.tenantId, table.createdAt),
    check(
      "import_batches_kind_check",
      sql`${table.kind} in ('partners', 'articles', 'hs_codes', 'purchase_lines', 'sales_lines', 'tasks')`,
    ),
    check("import_batches_status_check", sql`${table.status} in ('analyzed', 'applied')`),
    check(
      "import_batches_counts_check",
      sql`${table.rowCount} >= 0 and ${table.errorCount} >= 0 and ${table.warningCount} >= 0`,
    ),
    check("import_batches_hash_check", sql`${table.fileHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    status: text("status").$type<ImportRowStatus>().notNull(),
    code: text("code"),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("import_rows_batch_row_idx").on(table.batchId, table.rowNumber),
    index("import_rows_tenant_batch_idx").on(table.tenantId, table.batchId),
    check("import_rows_status_check", sql`${table.status} in ('valid', 'warning', 'error')`),
    check("import_rows_row_check", sql`${table.rowNumber} > 1`),
    foreignKey({
      name: "import_rows_tenant_batch_fk",
      columns: [table.tenantId, table.batchId],
      foreignColumns: [importBatches.tenantId, importBatches.id],
    }).onDelete("cascade"),
  ],
);

export const stockLocations = pgTable(
  "stock_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<StockLocationType>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_locations_tenant_code_idx").on(table.tenantId, table.code),
    uniqueIndex("stock_locations_tenant_id_idx").on(table.tenantId, table.id),
    index("stock_locations_tenant_type_idx").on(table.tenantId, table.type),
    check("stock_locations_code_format_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'`),
    check("stock_locations_name_check", sql`char_length(${table.name}) between 1 and 80`),
    check("stock_locations_type_check", sql`${table.type} in ('internal', 'supplier', 'customer')`),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number"),
    supplierId: uuid("supplier_id").notNull(),
    status: text("status").$type<PurchaseOrderStatus>().notNull().default("draft"),
    receiptState: text("receipt_state").$type<ReceiptState>().notNull().default("not_received"),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    expectedReceiptDate: date("expected_receipt_date", { mode: "string" }),
    externalReference: text("external_reference"),
    notes: text("notes"),
    exTaxTotal: integer("ex_tax_total").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("purchase_orders_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("purchase_orders_tenant_id_idx").on(table.tenantId, table.id),
    index("purchase_orders_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    index("purchase_orders_tenant_supplier_idx").on(table.tenantId, table.supplierId),
    check(
      "purchase_orders_status_check",
      sql`${table.status} in ('draft', 'requested', 'confirmed', 'closed', 'cancelled')`,
    ),
    check(
      "purchase_orders_receipt_state_check",
      sql`${table.receiptState} in ('not_received', 'partially_received', 'received')`,
    ),
    check("purchase_orders_total_check", sql`${table.exTaxTotal} between 0 and 2000000000`),
    check(
      "purchase_orders_reference_check",
      sql`${table.externalReference} is null or char_length(${table.externalReference}) <= 60`,
    ),
    check(
      "purchase_orders_number_check",
      sql`${table.number} is null or ${table.number} ~ '^CMD-[0-9]{4}-[0-9]{4}$'`,
    ),
    foreignKey({
      name: "purchase_orders_tenant_supplier_fk",
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("restrict"),
  ],
);

export const exchangeMessages = pgTable(
  "exchange_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").$type<ExchangeType>().notNull(),
    status: text("status").$type<ExchangeMessageStatus>().notNull(),
    orderId: uuid("order_id").notNull(),
    templateId: uuid("template_id"),
    templateName: text("template_name").notNull(),
    recipient: text("recipient").notNull(),
    recipientName: text("recipient_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html").notNull(),
    attachmentName: text("attachment_name").notNull(),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    resentFromId: uuid("resent_from_id"),
    replyTokenHash: text("reply_token_hash"),
    replyTokenExpiresAt: timestamp("reply_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("exchange_messages_tenant_id_idx").on(table.tenantId, table.id),
    index("exchange_messages_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("exchange_messages_tenant_order_idx").on(table.tenantId, table.orderId, table.createdAt),
    uniqueIndex("exchange_messages_reply_token_idx")
      .on(table.replyTokenHash)
      .where(sql`${table.replyTokenHash} is not null`),
    check(
      "exchange_messages_type_check",
      sql`${table.type} in ('purchase_request', 'purchase_confirmation')`,
    ),
    check("exchange_messages_status_check", sql`${table.status} in ('sent', 'failed')`),
    check(
      "exchange_messages_terminal_check",
      sql`(${table.status} = 'sent' and ${table.sentAt} is not null and ${table.errorMessage} is null) or (${table.status} = 'failed' and ${table.sentAt} is null and ${table.errorMessage} is not null)`,
    ),
    check(
      "exchange_messages_template_check",
      sql`char_length(${table.templateName}) between 1 and 120`,
    ),
    check(
      "exchange_messages_recipient_check",
      sql`char_length(${table.recipient}) between 3 and 160`,
    ),
    check(
      "exchange_messages_recipient_name_check",
      sql`${table.recipientName} is null or char_length(${table.recipientName}) <= 120`,
    ),
    check("exchange_messages_subject_check", sql`char_length(${table.subject}) between 1 and 200`),
    check(
      "exchange_messages_body_text_check",
      sql`char_length(${table.bodyText}) between 1 and 20000`,
    ),
    check(
      "exchange_messages_body_html_check",
      sql`char_length(${table.bodyHtml}) between 1 and 60000`,
    ),
    check(
      "exchange_messages_attachment_check",
      sql`char_length(${table.attachmentName}) between 1 and 200`,
    ),
    check(
      "exchange_messages_error_check",
      sql`${table.errorMessage} is null or char_length(${table.errorMessage}) <= 1000`,
    ),
    check(
      "exchange_messages_reply_token_check",
      sql`(${table.replyTokenHash} is null) = (${table.replyTokenExpiresAt} is null) and (${table.replyTokenHash} is null or ${table.replyTokenHash} ~ '^[0-9a-f]{64}$')`,
    ),
    foreignKey({
      name: "exchange_messages_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "exchange_messages_tenant_template_fk",
      columns: [table.tenantId, table.templateId],
      foreignColumns: [exchangeTemplates.tenantId, exchangeTemplates.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "exchange_messages_tenant_resent_fk",
      columns: [table.tenantId, table.resentFromId],
      foreignColumns: [table.tenantId, table.id],
    }).onDelete("restrict"),
  ],
);

export const supplierReplies = pgTable(
  "supplier_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    exchangeMessageId: uuid("exchange_message_id").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    availability: text("availability").$type<SupplierReplyAvailability>().notNull(),
    comment: text("comment"),
    leadTimeDays: integer("lead_time_days"),
    proposedTotalXof: integer("proposed_total_xof"),
    attachmentName: text("attachment_name"),
    attachmentMime: text("attachment_mime"),
    attachmentSize: integer("attachment_size"),
    attachmentData: bytea("attachment_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("supplier_replies_tenant_id_idx").on(table.tenantId, table.id),
    index("supplier_replies_tenant_order_idx").on(table.tenantId, table.orderId, table.createdAt),
    index("supplier_replies_tenant_message_idx").on(
      table.tenantId,
      table.exchangeMessageId,
      table.createdAt,
    ),
    check(
      "supplier_replies_availability_check",
      sql`${table.availability} in ('available', 'partial', 'unavailable')`,
    ),
    check(
      "supplier_replies_author_name_check",
      sql`char_length(${table.authorName}) between 1 and 120`,
    ),
    check(
      "supplier_replies_author_email_check",
      sql`${table.authorEmail} is null or char_length(${table.authorEmail}) <= 160`,
    ),
    check(
      "supplier_replies_comment_check",
      sql`${table.comment} is null or char_length(${table.comment}) <= 2000`,
    ),
    check(
      "supplier_replies_lead_time_check",
      sql`${table.leadTimeDays} is null or ${table.leadTimeDays} between 0 and 365`,
    ),
    check(
      "supplier_replies_total_check",
      sql`${table.proposedTotalXof} is null or ${table.proposedTotalXof} between 0 and 2000000000`,
    ),
    check(
      "supplier_replies_attachment_check",
      sql`(${table.attachmentName} is null) = (${table.attachmentMime} is null) and (${table.attachmentName} is null) = (${table.attachmentSize} is null) and (${table.attachmentName} is null) = (${table.attachmentData} is null) and (${table.attachmentName} is null or (char_length(${table.attachmentName}) between 1 and 200 and ${table.attachmentName} !~ '[/\\\\]'))`,
    ),
    check(
      "supplier_replies_attachment_mime_check",
      sql`${table.attachmentMime} is null or ${table.attachmentMime} in ('application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`,
    ),
    check(
      "supplier_replies_attachment_size_check",
      sql`${table.attachmentSize} is null or ${table.attachmentSize} between 1 and 5242880`,
    ),
    check(
      "supplier_replies_attachment_data_check",
      sql`${table.attachmentData} is null or octet_length(${table.attachmentData}) = ${table.attachmentSize}`,
    ),
    foreignKey({
      name: "supplier_replies_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "supplier_replies_tenant_message_fk",
      columns: [table.tenantId, table.exchangeMessageId],
      foreignColumns: [exchangeMessages.tenantId, exchangeMessages.id],
    }).onDelete("restrict"),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    articleId: uuid("article_id").notNull(),
    name: text("name").notNull(),
    unitCode: text("unit_code").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    unitPriceXof: integer("unit_price_xof").notNull(),
    lineTotalXof: integer("line_total_xof").notNull(),
    receivedQty: numeric("received_qty", { precision: 18, scale: 6 }).notNull().default("0"),
    receiptState: text("receipt_state").$type<ReceiptState>().notNull().default("not_received"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("purchase_order_lines_order_line_idx").on(
      table.tenantId,
      table.orderId,
      table.lineNumber,
    ),
    uniqueIndex("purchase_order_lines_tenant_id_idx").on(table.tenantId, table.id),
    index("purchase_order_lines_tenant_order_idx").on(table.tenantId, table.orderId),
    check("purchase_order_lines_number_check", sql`${table.lineNumber} > 0`),
    check("purchase_order_lines_qty_check", sql`${table.qty} > 0`),
    check("purchase_order_lines_price_check", sql`${table.unitPriceXof} between 0 and 2000000000`),
    check("purchase_order_lines_total_check", sql`${table.lineTotalXof} between 0 and 2000000000`),
    check("purchase_order_lines_received_check", sql`${table.receivedQty} >= 0`),
    check(
      "purchase_order_lines_receipt_state_check",
      sql`${table.receiptState} in ('not_received', 'partially_received', 'received')`,
    ),
    foreignKey({
      name: "purchase_order_lines_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "purchase_order_lines_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
  ],
);

export const receptions = pgTable(
  "receptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    orderId: uuid("order_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: text("status").$type<ReceptionStatus>().notNull().default("validated"),
    receivedDate: date("received_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("receptions_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("receptions_tenant_id_idx").on(table.tenantId, table.id),
    index("receptions_tenant_order_idx").on(table.tenantId, table.orderId, table.createdAt),
    check("receptions_status_check", sql`${table.status} in ('validated', 'cancelled')`),
    check("receptions_number_check", sql`${table.number} ~ '^REC-[0-9]{4}-[0-9]{4}$'`),
    check(
      "receptions_notes_check",
      sql`${table.notes} is null or char_length(${table.notes}) <= 1000`,
    ),
    foreignKey({
      name: "receptions_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "receptions_tenant_location_fk",
      columns: [table.tenantId, table.locationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete("restrict"),
  ],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number"),
    customerId: uuid("customer_id").notNull(),
    status: text("status").$type<SalesOrderStatus>().notNull().default("draft"),
    deliveryState: text("delivery_state").$type<DeliveryState>().notNull().default("not_delivered"),
    invoicingState: text("invoicing_state")
      .$type<InvoicingState>()
      .notNull()
      .default("not_invoiced"),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    expectedDeliveryDate: date("expected_delivery_date", { mode: "string" }),
    externalReference: text("external_reference"),
    incoterm: text("incoterm"),
    notes: text("notes"),
    exTaxTotal: integer("ex_tax_total").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sales_orders_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("sales_orders_tenant_id_idx").on(table.tenantId, table.id),
    index("sales_orders_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    index("sales_orders_tenant_customer_idx").on(table.tenantId, table.customerId),
    check(
      "sales_orders_status_check",
      sql`${table.status} in ('draft', 'confirmed', 'closed', 'cancelled')`,
    ),
    check(
      "sales_orders_delivery_state_check",
      sql`${table.deliveryState} in ('not_delivered', 'partially_delivered', 'delivered')`,
    ),
    check(
      "sales_orders_invoicing_state_check",
      sql`${table.invoicingState} in ('not_invoiced', 'partially_invoiced', 'invoiced')`,
    ),
    check("sales_orders_total_check", sql`${table.exTaxTotal} between 0 and 2000000000`),
    check(
      "sales_orders_reference_check",
      sql`${table.externalReference} is null or char_length(${table.externalReference}) <= 60`,
    ),
    check(
      "sales_orders_incoterm_check",
      sql`${table.incoterm} is null or ${table.incoterm} in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')`,
    ),
    check(
      "sales_orders_notes_check",
      sql`${table.notes} is null or char_length(${table.notes}) <= 1000`,
    ),
    check(
      "sales_orders_number_check",
      sql`${table.number} is null or ${table.number} ~ '^VTE-[0-9]{4}-[0-9]{4}$'`,
    ),
    foreignKey({
      name: "sales_orders_tenant_customer_fk",
      columns: [table.tenantId, table.customerId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("restrict"),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    orderId: uuid("order_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    articleId: uuid("article_id").notNull(),
    name: text("name").notNull(),
    unitCode: text("unit_code").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    unitPriceXof: integer("unit_price_xof").notNull(),
    lineTotalXof: integer("line_total_xof").notNull(),
    deliveredQty: numeric("delivered_qty", { precision: 18, scale: 6 }).notNull().default("0"),
    invoicedQty: numeric("invoiced_qty", { precision: 18, scale: 6 }).notNull().default("0"),
    deliveryState: text("delivery_state").$type<DeliveryState>().notNull().default("not_delivered"),
    invoicingState: text("invoicing_state")
      .$type<InvoicingState>()
      .notNull()
      .default("not_invoiced"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sales_order_lines_order_line_idx").on(
      table.tenantId,
      table.orderId,
      table.lineNumber,
    ),
    uniqueIndex("sales_order_lines_tenant_id_idx").on(table.tenantId, table.id),
    index("sales_order_lines_tenant_order_idx").on(table.tenantId, table.orderId),
    check("sales_order_lines_number_check", sql`${table.lineNumber} > 0`),
    check("sales_order_lines_qty_check", sql`${table.qty} > 0`),
    check("sales_order_lines_price_check", sql`${table.unitPriceXof} between 0 and 2000000000`),
    check("sales_order_lines_total_check", sql`${table.lineTotalXof} between 0 and 2000000000`),
    check(
      "sales_order_lines_delivered_check",
      sql`${table.deliveredQty} >= 0 and ${table.deliveredQty} <= ${table.qty}`,
    ),
    check(
      "sales_order_lines_invoiced_check",
      sql`${table.invoicedQty} >= 0 and ${table.invoicedQty} <= ${table.qty}`,
    ),
    check(
      "sales_order_lines_delivery_state_check",
      sql`${table.deliveryState} in ('not_delivered', 'partially_delivered', 'delivered')`,
    ),
    check(
      "sales_order_lines_invoicing_state_check",
      sql`${table.invoicingState} in ('not_invoiced', 'partially_invoiced', 'invoiced')`,
    ),
    foreignKey({
      name: "sales_order_lines_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sales_order_lines_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    orderId: uuid("order_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("validated"),
    deliveredDate: date("delivered_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("deliveries_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("deliveries_tenant_id_idx").on(table.tenantId, table.id),
    index("deliveries_tenant_order_idx").on(table.tenantId, table.orderId, table.createdAt),
    check("deliveries_status_check", sql`${table.status} in ('validated', 'cancelled')`),
    check("deliveries_number_check", sql`${table.number} ~ '^BL-[0-9]{4}-[0-9]{4}$'`),
    check(
      "deliveries_notes_check",
      sql`${table.notes} is null or char_length(${table.notes}) <= 1000`,
    ),
    foreignKey({
      name: "deliveries_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "deliveries_tenant_location_fk",
      columns: [table.tenantId, table.locationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete("restrict"),
  ],
);

export const deliveryLines = pgTable(
  "delivery_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    articleId: uuid("article_id").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("delivery_lines_delivery_line_idx").on(
      table.tenantId,
      table.deliveryId,
      table.lineNumber,
    ),
    uniqueIndex("delivery_lines_tenant_id_idx").on(table.tenantId, table.id),
    index("delivery_lines_tenant_delivery_idx").on(table.tenantId, table.deliveryId),
    index("delivery_lines_tenant_order_line_idx").on(table.tenantId, table.orderLineId),
    check("delivery_lines_number_check", sql`${table.lineNumber} > 0`),
    check("delivery_lines_qty_check", sql`${table.qty} > 0`),
    foreignKey({
      name: "delivery_lines_tenant_delivery_fk",
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "delivery_lines_tenant_order_line_fk",
      columns: [table.tenantId, table.orderLineId],
      foreignColumns: [salesOrderLines.tenantId, salesOrderLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "delivery_lines_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number"),
    orderId: uuid("order_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    exTaxTotal: integer("ex_tax_total").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invoices_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("invoices_tenant_id_idx").on(table.tenantId, table.id),
    index("invoices_tenant_status_idx").on(table.tenantId, table.status, table.invoiceDate),
    index("invoices_tenant_customer_idx").on(table.tenantId, table.customerId),
    index("invoices_tenant_order_idx").on(table.tenantId, table.orderId),
    check("invoices_status_check", sql`${table.status} in ('draft', 'validated', 'cancelled')`),
    check("invoices_total_check", sql`${table.exTaxTotal} between 0 and 2000000000`),
    check("invoices_dates_check", sql`${table.dueDate} >= ${table.invoiceDate}`),
    check(
      "invoices_notes_check",
      sql`${table.notes} is null or char_length(${table.notes}) <= 1000`,
    ),
    check(
      "invoices_number_check",
      sql`${table.number} is null or ${table.number} ~ '^FAC-[0-9]{4}-[0-9]{4}$'`,
    ),
    foreignKey({
      name: "invoices_tenant_order_fk",
      columns: [table.tenantId, table.orderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invoices_tenant_customer_fk",
      columns: [table.tenantId, table.customerId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("restrict"),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    orderLineId: uuid("order_line_id").notNull(),
    articleId: uuid("article_id").notNull(),
    name: text("name").notNull(),
    unitCode: text("unit_code").notNull(),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    unitPriceXof: integer("unit_price_xof").notNull(),
    lineTotalXof: integer("line_total_xof").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invoice_lines_invoice_line_idx").on(
      table.tenantId,
      table.invoiceId,
      table.lineNumber,
    ),
    uniqueIndex("invoice_lines_tenant_id_idx").on(table.tenantId, table.id),
    index("invoice_lines_tenant_invoice_idx").on(table.tenantId, table.invoiceId),
    index("invoice_lines_tenant_order_line_idx").on(table.tenantId, table.orderLineId),
    check("invoice_lines_number_check", sql`${table.lineNumber} > 0`),
    check("invoice_lines_qty_check", sql`${table.qty} > 0`),
    check("invoice_lines_price_check", sql`${table.unitPriceXof} between 0 and 2000000000`),
    check("invoice_lines_total_check", sql`${table.lineTotalXof} between 0 and 2000000000`),
    foreignKey({
      name: "invoice_lines_tenant_invoice_fk",
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "invoice_lines_tenant_order_line_fk",
      columns: [table.tenantId, table.orderLineId],
      foreignColumns: [salesOrderLines.tenantId, salesOrderLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "invoice_lines_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    amountXof: integer("amount_xof").notNull(),
    paidDate: date("paid_date", { mode: "string" }).notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    reference: text("reference"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invoice_payments_tenant_invoice_idx").on(
      table.tenantId,
      table.invoiceId,
      table.paidDate,
    ),
    check("invoice_payments_amount_check", sql`${table.amountXof} > 0`),
    check(
      "invoice_payments_method_check",
      sql`${table.method} in ('transfer', 'cash', 'cheque', 'mobile_money')`,
    ),
    check(
      "invoice_payments_reference_check",
      sql`${table.reference} is null or char_length(${table.reference}) <= 60`,
    ),
    foreignKey({
      name: "invoice_payments_tenant_invoice_fk",
      columns: [table.tenantId, table.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete("restrict"),
  ],
);

export const stockMoves = pgTable(
  "stock_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    type: text("type").$type<StockMoveType>().notNull(),
    fromLocationId: uuid("from_location_id").notNull(),
    toLocationId: uuid("to_location_id").notNull(),
    partnerId: uuid("partner_id"),
    purchaseOrderId: uuid("purchase_order_id"),
    receptionId: uuid("reception_id"),
    salesOrderId: uuid("sales_order_id"),
    deliveryId: uuid("delivery_id"),
    cancelsMoveId: uuid("cancels_move_id"),
    realDate: date("real_date", { mode: "string" }).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_moves_tenant_number_idx").on(table.tenantId, table.number),
    uniqueIndex("stock_moves_tenant_id_idx").on(table.tenantId, table.id),
    index("stock_moves_tenant_date_idx").on(table.tenantId, table.realDate),
    index("stock_moves_tenant_reception_idx").on(table.tenantId, table.receptionId),
    index("stock_moves_tenant_order_idx").on(table.tenantId, table.purchaseOrderId),
    index("stock_moves_tenant_sales_order_idx").on(table.tenantId, table.salesOrderId),
    index("stock_moves_tenant_delivery_idx").on(table.tenantId, table.deliveryId),
    check("stock_moves_type_check", sql`${table.type} in ('incoming', 'outgoing')`),
    check(
      "stock_moves_source_check",
      sql`${table.purchaseOrderId} is null or ${table.salesOrderId} is null`,
    ),
    check("stock_moves_number_check", sql`${table.number} ~ '^MVT-[0-9]{4}-[0-9]{4}$'`),
    check("stock_moves_locations_check", sql`${table.fromLocationId} <> ${table.toLocationId}`),
    check(
      "stock_moves_notes_check",
      sql`${table.notes} is null or char_length(${table.notes}) <= 1000`,
    ),
    foreignKey({
      name: "stock_moves_tenant_from_location_fk",
      columns: [table.tenantId, table.fromLocationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_to_location_fk",
      columns: [table.tenantId, table.toLocationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_partner_fk",
      columns: [table.tenantId, table.partnerId],
      foreignColumns: [partners.tenantId, partners.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_order_fk",
      columns: [table.tenantId, table.purchaseOrderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_reception_fk",
      columns: [table.tenantId, table.receptionId],
      foreignColumns: [receptions.tenantId, receptions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_sales_order_fk",
      columns: [table.tenantId, table.salesOrderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_delivery_fk",
      columns: [table.tenantId, table.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_moves_tenant_cancels_fk",
      columns: [table.tenantId, table.cancelsMoveId],
      foreignColumns: [table.tenantId, table.id],
    }).onDelete("restrict"),
  ],
);

export const stockMoveLines = pgTable(
  "stock_move_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    moveId: uuid("move_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    articleId: uuid("article_id").notNull(),
    purchaseOrderLineId: uuid("purchase_order_line_id"),
    salesOrderLineId: uuid("sales_order_line_id"),
    qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
    unitPriceXof: integer("unit_price_xof"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_move_lines_move_line_idx").on(
      table.tenantId,
      table.moveId,
      table.lineNumber,
    ),
    index("stock_move_lines_tenant_move_idx").on(table.tenantId, table.moveId),
    index("stock_move_lines_tenant_article_idx").on(table.tenantId, table.articleId),
    check("stock_move_lines_number_check", sql`${table.lineNumber} > 0`),
    check("stock_move_lines_qty_check", sql`${table.qty} > 0`),
    check(
      "stock_move_lines_price_check",
      sql`${table.unitPriceXof} is null or ${table.unitPriceXof} >= 0`,
    ),
    foreignKey({
      name: "stock_move_lines_tenant_move_fk",
      columns: [table.tenantId, table.moveId],
      foreignColumns: [stockMoves.tenantId, stockMoves.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_move_lines_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_move_lines_tenant_order_line_fk",
      columns: [table.tenantId, table.purchaseOrderLineId],
      foreignColumns: [purchaseOrderLines.tenantId, purchaseOrderLines.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_move_lines_tenant_sales_line_fk",
      columns: [table.tenantId, table.salesOrderLineId],
      foreignColumns: [salesOrderLines.tenantId, salesOrderLines.id],
    }).onDelete("restrict"),
  ],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    articleId: uuid("article_id").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("stock_levels_tenant_location_article_idx").on(
      table.tenantId,
      table.locationId,
      table.articleId,
    ),
    index("stock_levels_tenant_article_idx").on(table.tenantId, table.articleId),
    check("stock_levels_quantity_check", sql`${table.quantity} >= 0`),
    foreignKey({
      name: "stock_levels_tenant_location_fk",
      columns: [table.tenantId, table.locationId],
      foreignColumns: [stockLocations.tenantId, stockLocations.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_levels_tenant_article_fk",
      columns: [table.tenantId, table.articleId],
      foreignColumns: [articles.tenantId, articles.id],
    }).onDelete("restrict"),
  ],
);

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    scope: text("scope").$type<DocumentScope>().notNull(),
    period: integer("period").notNull(),
    lastValue: integer("last_value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("document_sequences_tenant_scope_period_idx").on(
      table.tenantId,
      table.scope,
      table.period,
    ),
    check(
      "document_sequences_scope_check",
      sql`${table.scope} in ('purchase_order', 'reception', 'stock_move', 'sales_order', 'delivery', 'invoice')`,
    ),
    check("document_sequences_period_check", sql`${table.period} between 2000 and 9999`),
    check("document_sequences_value_check", sql`${table.lastValue} >= 0`),
  ],
);

export type DiscussionEntityType =
  "partner" | "purchase_order" | "sales_order" | "invoice" | "task";
export type TaskRelatedEntityType = Exclude<DiscussionEntityType, "task">;
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type DiscussionMessageKind = "comment" | "event";
export type NotificationKind = "mention" | "event";

export const discussionMessages = pgTable(
  "discussion_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityType: text("entity_type").$type<DiscussionEntityType>().notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: text("kind").$type<DiscussionMessageKind>().notNull(),
    body: text("body").notNull(),
    eventType: text("event_type"),
    eventKey: text("event_key"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("discussion_messages_tenant_id_idx").on(table.tenantId, table.id),
    index("discussion_messages_tenant_entity_idx").on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    uniqueIndex("discussion_messages_tenant_event_idx")
      .on(table.tenantId, table.entityType, table.entityId, table.eventKey)
      .where(sql`${table.eventKey} is not null`),
    check("discussion_messages_kind_check", sql`${table.kind} in ('comment', 'event')`),
    check(
      "discussion_messages_entity_type_check",
      sql`${table.entityType} in ('partner', 'purchase_order', 'sales_order', 'invoice', 'task')`,
    ),
    check("discussion_messages_body_check", sql`char_length(${table.body}) between 1 and 4000`),
    check(
      "discussion_messages_event_check",
      sql`(${table.kind} = 'comment' and ${table.eventType} is null and ${table.eventKey} is null) or (${table.kind} = 'event' and ${table.eventType} is not null and ${table.eventKey} is not null)`,
    ),
    check(
      "discussion_messages_event_type_check",
      sql`${table.eventType} is null or char_length(${table.eventType}) between 1 and 80`,
    ),
    check(
      "discussion_messages_event_key_check",
      sql`${table.eventKey} is null or char_length(${table.eventKey}) between 1 and 120`,
    ),
  ],
);

export const discussionMentions = pgTable(
  "discussion_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull(),
    mentionedUserId: uuid("mentioned_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("discussion_mentions_message_user_idx").on(
      table.tenantId,
      table.messageId,
      table.mentionedUserId,
    ),
    index("discussion_mentions_tenant_user_idx").on(
      table.tenantId,
      table.mentionedUserId,
      table.createdAt,
    ),
    foreignKey({
      name: "discussion_mentions_tenant_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [discussionMessages.tenantId, discussionMessages.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "discussion_mentions_tenant_user_fk",
      columns: [table.tenantId, table.mentionedUserId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("restrict"),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<NotificationKind>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    entityType: text("entity_type").$type<DiscussionEntityType>().notNull(),
    entityId: uuid("entity_id").notNull(),
    messageId: uuid("message_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    eventKey: text("event_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notifications_tenant_user_event_idx").on(
      table.tenantId,
      table.userId,
      table.eventKey,
    ),
    index("notifications_tenant_user_read_idx").on(
      table.tenantId,
      table.userId,
      table.readAt,
      table.createdAt,
    ),
    check("notifications_kind_check", sql`${table.kind} in ('mention', 'event')`),
    check(
      "notifications_entity_type_check",
      sql`${table.entityType} in ('partner', 'purchase_order', 'sales_order', 'invoice', 'task')`,
    ),
    check("notifications_title_check", sql`char_length(${table.title}) between 1 and 200`),
    check("notifications_body_check", sql`char_length(${table.body}) between 1 and 500`),
    check("notifications_event_key_check", sql`char_length(${table.eventKey}) between 1 and 120`),
    foreignKey({
      name: "notifications_tenant_user_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "notifications_tenant_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [discussionMessages.tenantId, discussionMessages.id],
    }).onDelete("restrict"),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<TaskStatus>().notNull().default("open"),
    priority: text("priority").$type<TaskPriority>().notNull().default("normal"),
    dueDate: date("due_date", { mode: "string" }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    relatedEntityType: text("related_entity_type").$type<TaskRelatedEntityType>(),
    relatedEntityId: uuid("related_entity_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    elapsedSeconds: integer("elapsed_seconds").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tasks_tenant_id_idx").on(table.tenantId, table.id),
    index("tasks_tenant_status_due_idx").on(table.tenantId, table.status, table.dueDate),
    index("tasks_tenant_assignee_status_idx").on(
      table.tenantId,
      table.assigneeUserId,
      table.status,
    ),
    index("tasks_tenant_related_idx").on(
      table.tenantId,
      table.relatedEntityType,
      table.relatedEntityId,
    ),
    check("tasks_title_check", sql`char_length(${table.title}) between 1 and 160`),
    check("tasks_description_check", sql`char_length(${table.description}) <= 4000`),
    check(
      "tasks_status_check",
      sql`${table.status} in ('open', 'in_progress', 'done', 'cancelled')`,
    ),
    check("tasks_priority_check", sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`),
    check(
      "tasks_related_type_check",
      sql`${table.relatedEntityType} is null or ${table.relatedEntityType} in ('partner', 'purchase_order', 'sales_order', 'invoice')`,
    ),
    check(
      "tasks_related_pair_check",
      sql`(${table.relatedEntityType} is null) = (${table.relatedEntityId} is null)`,
    ),
    check(
      "tasks_completion_check",
      sql`(${table.status} = 'done') = (${table.completedAt} is not null) and (${table.completedAt} is null) = (${table.completedByUserId} is null)`,
    ),
    check(
      "tasks_started_check",
      sql`(${table.status} = 'in_progress') = (${table.startedAt} is not null)`,
    ),
    check("tasks_elapsed_check", sql`${table.elapsedSeconds} >= 0`),
    check("tasks_revision_check", sql`${table.revision} >= 0`),
  ],
);

export type HsCodeRow = typeof hsCodes.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
export type ArticleRow = typeof articles.$inferSelect;
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
export type StockLocationRow = typeof stockLocations.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;
export type ReceptionRow = typeof receptions.$inferSelect;
export type SalesOrderRow = typeof salesOrders.$inferSelect;
export type SalesOrderLineRow = typeof salesOrderLines.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryLineRow = typeof deliveryLines.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type InvoicePaymentRow = typeof invoicePayments.$inferSelect;
export type StockMoveRow = typeof stockMoves.$inferSelect;
export type StockMoveLineRow = typeof stockMoveLines.$inferSelect;
export type StockLevelRow = typeof stockLevels.$inferSelect;
export type DocumentSequenceRow = typeof documentSequences.$inferSelect;
export type DiscussionMessageRow = typeof discussionMessages.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
