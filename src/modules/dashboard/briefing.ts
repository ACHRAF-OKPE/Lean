// Briefing module – generates morning dashboard alerts
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  hrEmployees,
  hrLeaveRequests,
  invoicePayments,
  invoices,
  partners,
  purchaseOrders,
  tasks,
} from "@/db/schema";
import { todayIsoDate } from "@/lib/dates";

/** Types **/
export type BriefingAlertSeverity = "urgent" | "warning" | "info" | "success";
export type BriefingAlertCategory = "purchases" | "finance" | "stock" | "hr" | "tasks";

export interface BriefingAlert {
  readonly id: string;
  readonly severity: BriefingAlertSeverity;
  readonly category: BriefingAlertCategory;
  readonly title: string;
  readonly description: string;
  readonly count?: number;
  readonly amountXof?: number;
  readonly href: string;
  readonly actionLabel: string;
}

export interface MorningBriefingMetrics {
  readonly delayedPurchasesCount: number;
  readonly matchingDisputesCount: number;
  readonly readyForPaymentCount: number;
  readonly readyForPaymentAmountXof: number;
  readonly overdueInvoicesCount: number;
  readonly overdueInvoicesAmountXof: number;
  readonly pendingLeavesCount: number;
  readonly pendingTasksCount: number;
}

export interface MorningBriefing {
  readonly dateIso: string;
  readonly dateFormatted: string;
  readonly greeting: string;
  readonly totalAlerts: number;
  readonly urgentCount: number;
  readonly alerts: readonly BriefingAlert[];
  readonly metrics: MorningBriefingMetrics;
}

/** Helpers **/
const FRENCH_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const FRENCH_DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
export function formatFrenchDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return isoDate;
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayName = FRENCH_DAYS[d.getUTCDay()] ?? "";
  const monthName = FRENCH_MONTHS[month - 1] ?? "";
  return `${dayName} ${day} ${monthName} ${year}`;
}

type MatchingLine = { amountDifferenceXof?: number };

export async function getMorningBriefing({
  db,
  tenantId,
  userId,
  userName,
  today = todayIsoDate(),
}: {
  db: Database;
  tenantId: string;
  userId: string;
  userName?: string | null;
  today?: string;
}): Promise<MorningBriefing> {
  const [
    matchingDisputes,
    readyForPayment,
    delayedPurchases,
    overdueInvoices,
    pendingLeaves,
    myPendingTasks,
  ] = await Promise.all([
    // 1️⃣ Litiges (3‑Way Match)
    db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        matchingStatus: purchaseOrders.matchingStatus,
        supplierInvoiceNumber: purchaseOrders.supplierInvoiceNumber,
        supplierName: partners.name,
        matchingLines: purchaseOrders.matchingLines,
      })
      .from(purchaseOrders)
      .leftJoin(partners, eq(partners.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          inArray(purchaseOrders.matchingStatus, [
            "quantity_mismatch",
            "price_mismatch",
            "disputed",
          ]),
        ),
      )
      .orderBy(desc(purchaseOrders.updatedAt))
      .limit(10),

    // 2️⃣ Bons à payer (BAP) prêts
    db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        supplierInvoiceAmountXof: purchaseOrders.supplierInvoiceAmountXof,
        supplierInvoiceNumber: purchaseOrders.supplierInvoiceNumber,
      })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          eq(purchaseOrders.matchingStatus, "matched"),
          eq(purchaseOrders.supplierInvoiceNumber, sql`IS NOT NULL`),
        ),
      ),

    // 3️⃣ Commandes en retard de livraison
    db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        expectedReceiptDate: purchaseOrders.expectedReceiptDate,
        supplierName: partners.name,
      })
      .from(purchaseOrders)
      .leftJoin(partners, eq(partners.id, purchaseOrders.supplierId))
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          eq(purchaseOrders.status, "confirmed"),
          inArray(purchaseOrders.receiptState, ["not_received", "partially_received"]),
          lte(purchaseOrders.expectedReceiptDate, today),
        ),
      )
      .orderBy(purchaseOrders.expectedReceiptDate)
      .limit(10),

    // 4️⃣ Factures clients échues impayées
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        dueDate: invoices.dueDate,
        balanceDueXof: sql<number>`
          ${invoices.exTaxTotal} -
          COALESCE(
            (SELECT SUM(${invoicePayments.amountXof}) FROM ${invoicePayments} WHERE ${invoicePayments.invoiceId} = ${invoices.id}),
            0
          )
        `,
        clientName: partners.name,
      })
      .from(invoices)
      .leftJoin(partners, eq(partners.id, invoices.customerId))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.status, "validated"),
          lte(invoices.dueDate, today),
          sql`(${sql`balanceDueXof`} > 0)`,
        ),
      )
      .orderBy(invoices.dueDate)
      .limit(10),

    // 5️⃣ Demandes de congés en attente (RH)
    db
      .select({
        id: hrLeaveRequests.id,
        employeeName: sql<string>`coalesce(${hrEmployees.firstName} || ' ' || ${hrEmployees.lastName}, 'Collaborateur')`,
        startDate: hrLeaveRequests.startDate,
        endDate: hrLeaveRequests.endDate,
      })
      .from(hrLeaveRequests)
      .leftJoin(hrEmployees, eq(hrEmployees.id, hrLeaveRequests.employeeId))
      .where(and(eq(hrLeaveRequests.tenantId, tenantId), eq(hrLeaveRequests.status, "draft")))
      .orderBy(hrLeaveRequests.createdAt)
      .limit(10),

    // 6️⃣ Tâches personnelles en retard ou d’aujourd’hui
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          eq(tasks.assigneeUserId, userId),
          inArray(tasks.status, ["open", "in_progress"]),
          sql`(${tasks.dueDate} IS NULL OR ${tasks.dueDate} <= ${today})`,
        ),
      )
      .orderBy(tasks.dueDate)
      .limit(10),
  ]);

  // Post‑processing: compute discrepancy from matchingLines JSON
  const matchingDisputesWithDiscrepancy = matchingDisputes.map((d) => ({
    ...d,
    matchingDiscrepancyXof:
      (d.matchingLines as unknown as MatchingLine[] | undefined)?.reduce(
        (sum, line) => sum + Math.abs(line.amountDifferenceXof ?? 0),
        0,
      ) ?? 0,
  }));

  const alerts: BriefingAlert[] = [];

  // A – Litiges
  if (matchingDisputesWithDiscrepancy.length > 0) {
    const totalDiscrepancy = matchingDisputesWithDiscrepancy.reduce(
      (s, d) => s + (d.matchingDiscrepancyXof ?? 0),
      0,
    );
    const first = matchingDisputesWithDiscrepancy[0];
    const href =
      matchingDisputesWithDiscrepancy.length === 1 && first ? `/achats/${first.id}` : "/achats";
    alerts.push({
      id: "matching-disputes",
      severity: "urgent",
      category: "purchases",
      title: `${matchingDisputesWithDiscrepancy.length} facture${matchingDisputesWithDiscrepancy.length > 1 ? "s" : ""} fournisseur en litige (3‑Way Match)`,
      description: `Écart total constaté de ${totalDiscrepancy.toLocaleString("fr-FR")} XOF entre commande, réception physique et facture.`,
      count: matchingDisputesWithDiscrepancy.length,
      amountXof: totalDiscrepancy,
      href,
      actionLabel: "Arbitrer les écarts",
    });
  }

  // B – Commandes en retard
  if (delayedPurchases.length > 0) {
    alerts.push({
      id: "delayed-purchases",
      severity: "warning",
      category: "purchases",
      title: `${delayedPurchases.length} commande${delayedPurchases.length > 1 ? "s" : ""} en retard de livraison`,
      description:
        "La date convenue avec les fournisseurs est dépassée sans réception physique complète au magasin.",
      count: delayedPurchases.length,
      href: "/achats",
      actionLabel: "Relancer fournisseurs",
    });
  }

  // C – Factures clients échues
  if (overdueInvoices.length > 0) {
    const totalOverdue = overdueInvoices.reduce((s, i) => s + (i.balanceDueXof as number), 0);
    alerts.push({
      id: "overdue-invoices",
      severity: "urgent",
      category: "finance",
      title: `${overdueInvoices.length} créance${overdueInvoices.length > 1 ? "s" : ""} client en retard d'échéance`,
      description: `Montant total échu non recouvré : ${totalOverdue.toLocaleString("fr-FR")} XOF.`,
      count: overdueInvoices.length,
      amountXof: totalOverdue,
      href: "/factures",
      actionLabel: "Gérer les relances",
    });
  }

  // D – Bons à payer (BAP)
  if (readyForPayment.length > 0) {
    const totalBap = readyForPayment.reduce(
      (s, p) => s + (p.supplierInvoiceAmountXof as number),
      0,
    );
    alerts.push({
      id: "ready-bap",
      severity: "success",
      category: "finance",
      title: `${readyForPayment.length} bon${readyForPayment.length > 1 ? "s" : ""} à payer certifié${readyForPayment.length > 1 ? "s" : ""}`,
      description: `Montant total certifié prêt pour ordonnancement : ${totalBap.toLocaleString("fr-FR")} XOF.`,
      count: readyForPayment.length,
      amountXof: totalBap,
      href: "/achats",
      actionLabel: "Voir les BAP",
    });
  }

  // E – Congés en attente
  if (pendingLeaves.length > 0) {
    alerts.push({
      id: "pending-leaves",
      severity: "info",
      category: "hr",
      title: `${pendingLeaves.length} demande${pendingLeaves.length > 1 ? "s" : ""} de congés à valider`,
      description: "Collaborateurs en attente d'arbitrage de leur calendrier d'absence.",
      count: pendingLeaves.length,
      href: "/rh/conges",
      actionLabel: "Examiner",
    });
  }

  // F – Tâches personnelles
  if (myPendingTasks.length > 0) {
    alerts.push({
      id: "my-tasks",
      severity: "info",
      category: "tasks",
      title: `${myPendingTasks.length} tâche${myPendingTasks.length > 1 ? "s" : ""} assignée${myPendingTasks.length > 1 ? "s" : ""} à traiter`,
      description:
        "Tâches à réaliser aujourd'hui ou en attente sur votre tableau de bord personnel.",
      count: myPendingTasks.length,
      href: "/taches",
      actionLabel: "Accéder aux tâches",
    });
  }

  const urgentCount = alerts.filter((a) => a.severity === "urgent").length;
  const totalReadyBapXof = readyForPayment.reduce(
    (s, p) => s + (p.supplierInvoiceAmountXof as number),
    0,
  );
  const totalOverdueXof = overdueInvoices.reduce((s, i) => s + (i.balanceDueXof as number), 0);

  const greetingName = userName ? ` ${userName}` : "";
  const greeting = `Bonjour${greetingName} · Briefing opérationnel`;

  return {
    dateIso: today,
    dateFormatted: formatFrenchDate(today),
    greeting,
    totalAlerts: alerts.length,
    urgentCount,
    alerts,
    metrics: {
      delayedPurchasesCount: delayedPurchases.length,
      matchingDisputesCount: matchingDisputesWithDiscrepancy.length,
      readyForPaymentCount: readyForPayment.length,
      readyForPaymentAmountXof: totalReadyBapXof,
      overdueInvoicesCount: overdueInvoices.length,
      overdueInvoicesAmountXof: totalOverdueXof,
      pendingLeavesCount: pendingLeaves.length,
      pendingTasksCount: myPendingTasks.length,
    },
  };
}
