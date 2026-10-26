import { describe, expect, it } from "vitest";
import { renderExchangeLines, renderExchangeTemplate } from "./render";

const VALUES = {
  "company.legal_name": "Lean SARL",
  "supplier.contact": "Mariam Traoré",
  "order.number": "CMD-2026-0001",
  "order.total": "125 000 F CFA",
  "order.notes": '<script>alert(1)</script> & "guillemets"',
};

const LINES = renderExchangeLines([
  {
    lineNumber: 1,
    name: "Café vert",
    unitCode: "KG",
    qty: "2",
    unitPriceLabel: "1 000 F CFA",
    totalLabel: "2 000 F CFA",
  },
]);

describe("ORG-007 — rendu des variables", () => {
  it("ORG-007 remplace les variables du sujet et du corps", () => {
    const rendered = renderExchangeTemplate(
      "Demande {{order.number}} — {{company.legal_name}}",
      "Bonjour {{supplier.contact}},\nTotal : {{order.total}}.",
      VALUES,
      LINES,
    );
    expect(rendered.subject).toBe("Demande CMD-2026-0001 — Lean SARL");
    expect(rendered.text).toContain("Bonjour Mariam Traoré,");
    expect(rendered.text).toContain("Total : 125 000 F CFA.");
    expect(rendered.html).toContain("Bonjour Mariam Traoré,");
  });

  it("ORG-007 échappe les valeurs dans le HTML", () => {
    const rendered = renderExchangeTemplate("Sujet", "Notes : {{order.notes}}", VALUES, LINES);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("&amp;");
    expect(rendered.text).toContain("<script>alert(1)</script>");
  });

  it("ORG-007 insère le tableau des lignes en texte et en HTML", () => {
    const rendered = renderExchangeTemplate("Sujet", "Lignes :\n{{order.lines}}", VALUES, LINES);
    expect(rendered.text).toContain("1. Café vert — 2 KG × 1 000 F CFA = 2 000 F CFA");
    expect(rendered.html).toContain("<table");
    expect(rendered.html).toContain("Café vert");
    expect(rendered.html).not.toContain("{{order.lines}}");
  });

  it("ORG-007 tolère les espaces dans les délimiteurs", () => {
    const rendered = renderExchangeTemplate("Sujet", "{{ company.legal_name }}", VALUES, LINES);
    expect(rendered.text.trim()).toBe("Lean SARL");
  });
});
