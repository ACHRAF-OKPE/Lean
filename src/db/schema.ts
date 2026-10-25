import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
export type ImportKind = "partners" | "articles" | "hs_codes" | "purchase_lines";
export type ImportBatchStatus = "analyzed" | "applied";
export type ImportRowStatus = "valid" | "warning" | "error";
export type PurchaseOrderStatus = "draft" | "requested" | "confirmed" | "closed" | "cancelled";
export type ReceiptState = "not_received" | "partially_received" | "received";
export type ReceptionStatus = "validated" | "cancelled";
export type StockLocationType = "internal" | "supplier";
export type StockMoveType = "incoming" | "outgoing";
export type DocumentScope = "purchase_order" | "reception" | "stock_move";

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
      sql`${table.kind} in ('partners', 'articles', 'hs_codes', 'purchase_lines')`,
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
    check("stock_locations_type_check", sql`${table.type} in ('internal', 'supplier')`),
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
    check("stock_moves_type_check", sql`${table.type} in ('incoming', 'outgoing')`),
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
      sql`${table.scope} in ('purchase_order', 'reception', 'stock_move')`,
    ),
    check("document_sequences_period_check", sql`${table.period} between 2000 and 9999`),
    check("document_sequences_value_check", sql`${table.lastValue} >= 0`),
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
export type StockMoveRow = typeof stockMoves.$inferSelect;
export type StockMoveLineRow = typeof stockMoveLines.$inferSelect;
export type StockLevelRow = typeof stockLevels.$inferSelect;
export type DocumentSequenceRow = typeof documentSequences.$inferSelect;
