import type { DiscussionEntityType, SupplierReplyAvailability, TaskStatus } from "@/db/schema";
import { formatXof } from "@/lib/money";
import { TASK_STATUS_LABELS } from "@/modules/tasks/constants";

export type DocumentEventType =
  | "purchase_order.requested"
  | "purchase_order.confirmed"
  | "purchase_order.closed"
  | "purchase_order.cancelled"
  | "purchase_order.received"
  | "purchase_order.reception_cancelled"
  | "purchase_order.supplier_reply"
  | "sales_order.confirmed"
  | "sales_order.closed"
  | "sales_order.cancelled"
  | "sales_order.delivered"
  | "sales_order.delivery_cancelled"
  | "invoice.validated"
  | "invoice.payment"
  | "task.created"
  | "task.status"
  | "task.assignee";

export interface DocumentEventInput {
  readonly type: DocumentEventType;
  readonly entityType: DiscussionEntityType;
  readonly key: string;
  readonly number?: string | null;
  readonly amountXof?: number | null;
  readonly availability?: SupplierReplyAvailability;
  readonly taskTitle?: string | null;
  readonly status?: TaskStatus;
  readonly previousStatus?: TaskStatus;
  readonly assigneeName?: string | null;
}

export interface DocumentEventDescriptor {
  readonly type: DocumentEventType;
  readonly entityType: DiscussionEntityType;
  readonly eventKey: string;
  readonly title: string;
  readonly body: string;
}

const TITLES: Record<DocumentEventType, string> = {
  "purchase_order.requested": "Commande fournisseur demandée",
  "purchase_order.confirmed": "Commande fournisseur confirmée",
  "purchase_order.closed": "Commande fournisseur clôturée",
  "purchase_order.cancelled": "Commande fournisseur annulée",
  "purchase_order.received": "Réception enregistrée",
  "purchase_order.reception_cancelled": "Réception annulée",
  "purchase_order.supplier_reply": "Réponse fournisseur reçue",
  "sales_order.confirmed": "Commande client confirmée",
  "sales_order.closed": "Commande client clôturée",
  "sales_order.cancelled": "Commande client annulée",
  "sales_order.delivered": "Livraison enregistrée",
  "sales_order.delivery_cancelled": "Livraison annulée",
  "invoice.validated": "Facture validée",
  "invoice.payment": "Paiement enregistré",
  "task.created": "Tâche créée",
  "task.status": "Statut de tâche mis à jour",
  "task.assignee": "Assignation de tâche mise à jour",
};

function reference(number: string | null | undefined): string {
  return number ? ` ${number}` : "";
}

const AVAILABILITY_TEXT: Record<SupplierReplyAvailability, string> = {
  available: "disponible",
  partial: "partiellement disponible",
  unavailable: "indisponible",
};

function taskTitle(input: DocumentEventInput): string {
  return input.taskTitle?.trim() || "sans titre";
}

export function describeDocumentEvent(input: DocumentEventInput): DocumentEventDescriptor {
  const suffix = reference(input.number);

  let body: string;
  switch (input.type) {
    case "purchase_order.requested":
      body = `La commande fournisseur${suffix} a été demandée.`;
      break;
    case "purchase_order.confirmed":
      body = `La commande fournisseur${suffix} a été confirmée.`;
      break;
    case "purchase_order.closed":
      body = `La commande fournisseur${suffix} a été clôturée.`;
      break;
    case "purchase_order.cancelled":
      body = `La commande fournisseur${suffix} a été annulée.`;
      break;
    case "purchase_order.received":
      body = `La réception${suffix} a été enregistrée.`;
      break;
    case "purchase_order.reception_cancelled":
      body = `La réception${suffix} a été annulée.`;
      break;
    case "purchase_order.supplier_reply":
      body = input.availability
        ? `Le fournisseur a indiqué que la commande fournisseur${suffix} est ${AVAILABILITY_TEXT[input.availability]}.`
        : `Le fournisseur a répondu à la commande fournisseur${suffix}.`;
      break;
    case "sales_order.confirmed":
      body = `La commande client${suffix} a été confirmée.`;
      break;
    case "sales_order.closed":
      body = `La commande client${suffix} a été clôturée.`;
      break;
    case "sales_order.cancelled":
      body = `La commande client${suffix} a été annulée.`;
      break;
    case "sales_order.delivered":
      body = `La livraison${suffix} a été enregistrée.`;
      break;
    case "sales_order.delivery_cancelled":
      body = `La livraison${suffix} a été annulée.`;
      break;
    case "invoice.validated":
      body = `La facture${suffix} a été validée pour ${formatXof(input.amountXof ?? 0)}.`;
      break;
    case "invoice.payment":
      body = `Un paiement de ${formatXof(input.amountXof ?? 0)} a été enregistré.`;
      break;
    case "task.created":
      body = input.assigneeName
        ? `La tâche « ${taskTitle(input)} » a été créée et assignée à ${input.assigneeName}.`
        : `La tâche « ${taskTitle(input)} » a été créée.`;
      break;
    case "task.status":
      body =
        input.previousStatus && input.status
          ? `La tâche « ${taskTitle(input)} » est passée de « ${TASK_STATUS_LABELS[input.previousStatus]} » à « ${TASK_STATUS_LABELS[input.status]} ».`
          : `Le statut de la tâche « ${taskTitle(input)} » a été mis à jour.`;
      break;
    case "task.assignee":
      body = input.assigneeName
        ? `La tâche « ${taskTitle(input)} » est assignée à ${input.assigneeName}.`
        : `La tâche « ${taskTitle(input)} » n'est plus assignée.`;
      break;
  }

  return {
    type: input.type,
    entityType: input.entityType,
    eventKey: `${input.type}:${input.key}`,
    title: TITLES[input.type],
    body,
  };
}
