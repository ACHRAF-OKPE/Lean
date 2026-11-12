import { describe, expect, it } from "vitest";
import { computeThreeWayMatching, matchingStatusLabel, lineMatchingStatusLabel } from "./matching";
import type { OrderLineForMatching, InvoiceMatchingInput } from "./matching";

describe("PUR-016 — Rapprochement tripartite (3-Way Match) & Bon à Payer", () => {
  it("valide un rapprochement 100 % conforme et accorde le bon à payer", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-1",
        name: "Ciment CPJ 45",
        unitCode: "SAC",
        type: "product",
        orderedQty: "100",
        orderedUnitPriceXof: 5000,
        receivedQty: "100",
      },
      {
        orderLineId: "line-2",
        name: "Fer à béton 12mm",
        unitCode: "BARRE",
        type: "product",
        orderedQty: "50",
        orderedUnitPriceXof: 8000,
        receivedQty: "50",
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-CFAO-2026-001",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-1",
          invoicedQty: "100",
          invoicedUnitPriceXof: 5000,
        },
        {
          orderLineId: "line-2",
          invoicedQty: "50",
          invoicedUnitPriceXof: 8000,
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("matched");
    expect(result.isApprovedForPayment).toBe(true);
    expect(result.totalOrderedXof).toBe(900000);
    expect(result.totalReceivedXof).toBe(900000);
    expect(result.totalInvoicedXof).toBe(900000);
    expect(result.netDiscrepancyXof).toBe(0);
    expect(result.summaryNotice).toContain("Bon à payer certifié");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.status).toBe("matched");
    expect(result.lines[1]?.status).toBe("matched");
  });

  it("bloque le paiement en cas de surfacturation sur la quantité", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-1",
        name: "Groupe électrogène",
        unitCode: "U",
        type: "product",
        orderedQty: "10",
        orderedUnitPriceXof: 1500000,
        receivedQty: "7", // Seulement 7 reçus sur 10 commandés
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-GEN-99",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-1",
          invoicedQty: "10", // Le fournisseur facture les 10
          invoicedUnitPriceXof: 1500000,
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("quantity_mismatch");
    expect(result.isApprovedForPayment).toBe(false);
    expect(result.totalReceivedXof).toBe(10500000);
    expect(result.totalInvoicedXof).toBe(15000000);
    expect(result.netDiscrepancyXof).toBe(4500000);
    expect(result.summaryNotice).toContain("surfacturation par rapport aux réceptions physiques");
    expect(result.lines[0]?.status).toBe("quantity_mismatch");
    expect(result.lines[0]?.qtyDifference).toBe("3");
  });

  it("bloque le paiement en cas de surcoût tarifaire non convenu", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-1",
        name: "Carburant Diesel",
        unitCode: "L",
        type: "product",
        orderedQty: "1000",
        orderedUnitPriceXof: 650,
        receivedQty: "1000",
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-TOTAL-2026-10",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-1",
          invoicedQty: "1000",
          invoicedUnitPriceXof: 700, // 700 XOF au lieu de 650 convenu
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("price_mismatch");
    expect(result.isApprovedForPayment).toBe(false);
    expect(result.totalOrderedXof).toBe(650000);
    expect(result.totalInvoicedXof).toBe(700000);
    expect(result.netDiscrepancyXof).toBe(50000);
    expect(result.summaryNotice).toContain("dépassement tarifaire");
    expect(result.lines[0]?.status).toBe("price_mismatch");
    expect(result.lines[0]?.unitPriceDifferenceXof).toBe(50);
  });

  it("suspend le paiement lorsque la facture arrive avant toute livraison", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-1",
        name: "Ordinateurs portables",
        unitCode: "U",
        type: "product",
        orderedQty: "5",
        orderedUnitPriceXof: 600000,
        receivedQty: "0", // Rien reçu
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-DELL-404",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-1",
          invoicedQty: "5",
          invoicedUnitPriceXof: 600000,
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("pending_receipt");
    expect(result.isApprovedForPayment).toBe(false);
    expect(result.summaryNotice).toContain("aucune réception physique n'a encore été enregistrée");
    expect(result.lines[0]?.status).toBe("pending_receipt");
  });

  it("gère correctement les lignes de services sans exiger de réception magasin", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-service",
        name: "Prestation de maintenance",
        unitCode: "FORFAIT",
        type: "service",
        orderedQty: "1",
        orderedUnitPriceXof: 250000,
        receivedQty: "0",
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-MAINT-01",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-service",
          invoicedQty: "1",
          invoicedUnitPriceXof: 250000,
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("matched");
    expect(result.isApprovedForPayment).toBe(true);
    expect(result.lines[0]?.status).toBe("matched");
  });

  it("détecte un litige en cas de divergences cumulées prix et quantité", () => {
    const orderLines: OrderLineForMatching[] = [
      {
        orderLineId: "line-1",
        name: "Câbles RJ45",
        unitCode: "M",
        type: "product",
        orderedQty: "500",
        orderedUnitPriceXof: 300,
        receivedQty: "400",
      },
    ];

    const invoice: InvoiceMatchingInput = {
      supplierInvoiceNumber: "FAC-NET-12",
      supplierInvoiceDate: "2026-11-12",
      lines: [
        {
          orderLineId: "line-1",
          invoicedQty: "600", // +200 vs reçu
          invoicedUnitPriceXof: 350, // +50 XOF
        },
      ],
    };

    const result = computeThreeWayMatching(orderLines, invoice);

    expect(result.status).toBe("disputed");
    expect(result.isApprovedForPayment).toBe(false);
    expect(result.lines[0]?.status).toBe("disputed");
  });

  it("fournit des libellés français clairs pour chaque statut", () => {
    expect(matchingStatusLabel("matched")).toBe("Conforme — Bon à payer");
    expect(matchingStatusLabel("quantity_mismatch")).toBe("Écart de quantité");
    expect(matchingStatusLabel("price_mismatch")).toBe("Écart de prix");
    expect(matchingStatusLabel("pending_receipt")).toBe("En attente de réception");
    expect(matchingStatusLabel("disputed")).toBe("En litige");
    expect(matchingStatusLabel("unmatched")).toBe("Non rapproché");

    expect(lineMatchingStatusLabel("matched")).toBe("Conforme");
    expect(lineMatchingStatusLabel("quantity_mismatch")).toBe("Surfacturation quantité");
    expect(lineMatchingStatusLabel("price_mismatch")).toBe("Surcoût tarifaire");
  });
});
