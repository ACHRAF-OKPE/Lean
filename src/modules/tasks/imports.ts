import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  importRows,
  invoices,
  memberships,
  partners,
  purchaseOrders,
  salesOrders,
  tasks,
  users,
} from "@/db/schema";
import { documentKey, titleKey, type TaskImportData } from "./import-validation";
import { TasksError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface StoredTaskRow {
  readonly rowNumber: number;
  readonly data: Record<string, unknown>;
}

export interface ApplyTaskImportInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly batchId: string;
  readonly rows: readonly StoredTaskRow[];
}

function numberMap(rows: readonly { id: string; number: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.number) {
      map.set(documentKey(row.number), row.id);
    }
  }
  return map;
}

export async function loadTaskImportContext(db: Database, tenantId: string) {
  const [memberRows, partnerRows, purchaseRows, salesRows, invoiceRows, openRows] =
    await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId)),
      db
        .select({ id: partners.id, code: partners.code })
        .from(partners)
        .where(eq(partners.tenantId, tenantId)),
      db
        .select({ id: purchaseOrders.id, number: purchaseOrders.number })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.tenantId, tenantId), isNotNull(purchaseOrders.number))),
      db
        .select({ id: salesOrders.id, number: salesOrders.number })
        .from(salesOrders)
        .where(and(eq(salesOrders.tenantId, tenantId), isNotNull(salesOrders.number))),
      db
        .select({ id: invoices.id, number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), isNotNull(invoices.number))),
      db
        .select({ title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.status, ["open", "in_progress"]))),
    ]);

  return {
    taskMembersByEmail: new Map(
      memberRows.map((row) => [row.email.toLowerCase(), { id: row.id, name: row.name }]),
    ),
    taskDocuments: {
      partner: new Map(partnerRows.map((row) => [documentKey(row.code), row.id])),
      purchase_order: numberMap(purchaseRows),
      sales_order: numberMap(salesRows),
      invoice: numberMap(invoiceRows),
    },
    openTaskTitles: new Set(openRows.map((row) => titleKey(row.title))),
  };
}

export async function applyTaskImport(
  tx: Transaction,
  input: ApplyTaskImportInput,
): Promise<{ readonly written: number }> {
  if (input.rows.length === 0) {
    throw new TasksError("Aucune tâche applicable dans cet import.");
  }

  for (const row of input.rows) {
    const data = row.data as unknown as TaskImportData;
    const [created] = await tx
      .insert(tasks)
      .values({
        tenantId: input.tenantId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate,
        assigneeUserId: data.assigneeUserId,
        relatedEntityType: data.relatedEntityType,
        relatedEntityId: data.relatedEntityId,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: tasks.id });
    if (!created) {
      throw new TasksError(`Ligne ${row.rowNumber} : la tâche n'a pas pu être enregistrée.`);
    }

    await tx
      .update(importRows)
      .set({ entityId: created.id })
      .where(
        and(
          eq(importRows.tenantId, input.tenantId),
          eq(importRows.batchId, input.batchId),
          eq(importRows.rowNumber, row.rowNumber),
        ),
      );
  }

  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "task.import",
    entityType: "import_batch",
    entityId: input.batchId,
    details: { source: "xlsx_import", batchId: input.batchId, count: input.rows.length },
  });

  return { written: input.rows.length };
}
