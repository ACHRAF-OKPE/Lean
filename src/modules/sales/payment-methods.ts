import type { PaymentMethod } from "@/db/schema";

export const PAYMENT_METHODS = ["transfer", "cash", "cheque", "mobile_money"] as const;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Virement",
  cash: "Espèces",
  cheque: "Chèque",
  mobile_money: "Mobile money",
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}
