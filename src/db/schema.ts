import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

export type PartnerType = "company" | "individual";
export type ArticleType = "product" | "service";
export type ImportKind = "partners" | "articles" | "hs_codes";
export type ImportBatchStatus = "analyzed" | "applied";
export type ImportRowStatus = "valid" | "warning" | "error";

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
    check("import_batches_kind_check", sql`${table.kind} in ('partners', 'articles', 'hs_codes')`),
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

export type HsCodeRow = typeof hsCodes.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
export type ArticleRow = typeof articles.$inferSelect;
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
