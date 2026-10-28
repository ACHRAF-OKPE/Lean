import { describe, expect, it } from "vitest";
import { MAX_XOF_AMOUNT } from "./constants";
import {
  EMPTY_VALIDATION_CONTEXT,
  hsCodeField,
  validateImportRows,
  type RawImportRow,
  type ValidationContext,
} from "./validation";

function row(rowNumber: number, values: Record<string, unknown>): RawImportRow {
  return { rowNumber, values };
}

const CONTEXT_WITH_HS: ValidationContext = {
  ...EMPTY_VALIDATION_CONTEXT,
  existingHsCodes: new Map([["0901110000", "Café non torréfié"]]),
};

const CONTEXT_WITH_PARTNER: ValidationContext = {
  ...EMPTY_VALIDATION_CONTEXT,
  existingPartnerCodes: new Set(["CLI001"]),
};

const CONTEXT_WITH_ARTICLE: ValidationContext = {
  ...EMPTY_VALIDATION_CONTEXT,
  existingHsCodes: new Map([["0901110000", "Café non torréfié"]]),
  existingArticleCodes: new Set(["ART001"]),
};

function partnerValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "CLI001",
    nom: "Sahel Distribution",
    type: "Entreprise",
    client: "Oui",
    fournisseur: "Non",
    ...overrides,
  };
}

function articleValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: "ART001",
    designation: "Café vert en sacs de 60 kg",
    type: "Produit",
    unite: "KG",
    code_sh: "0901110000",
    prix_vente_xof: "250000",
    prix_achat_xof: "180000",
    ...overrides,
  };
}

describe("ART-001 — tiers", () => {
  it("accepte un tiers complet et normalise le code en majuscules", () => {
    const result = validateImportRows("partners", [row(2, partnerValues({ code: "cli001" }))]);

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
    expect(result.rows[0]?.code).toBe("CLI001");
    expect(result.rows[0]?.warnings).toContain("Code : normalisé en majuscules.");
    expect(result.rows[0]?.data).toMatchObject({
      code: "CLI001",
      name: "Sahel Distribution",
      type: "company",
      isCustomer: true,
      isSupplier: false,
      paymentTermDays: 0,
      active: true,
    });
  });

  it("refuse un tiers sans code, sans nom ou sans rôle", () => {
    const result = validateImportRows("partners", [
      row(2, partnerValues({ code: null, nom: "", client: "Non", fournisseur: "Non" })),
    ]);

    expect(result.errorCount).toBe(1);
    expect(result.rows[0]?.status).toBe("error");
    expect(result.rows[0]?.errors).toEqual(
      expect.arrayContaining([
        "Code : obligatoire.",
        "Nom : obligatoire.",
        "Rôles : le tiers doit être au moins client ou fournisseur.",
      ]),
    );
  });

  it("refuse un pays hors ISO 3166-1 et un délai de paiement décimal", () => {
    const result = validateImportRows("partners", [
      row(2, partnerValues({ pays: "SEN", delai_paiement_jours: "30.5" })),
    ]);

    expect(result.rows[0]?.status).toBe("error");
    expect(result.rows[0]?.errors).toEqual(
      expect.arrayContaining([
        "Pays : code ISO 3166-1 à deux lettres attendu (ex. SN).",
        "Délai de paiement : nombre entier attendu, sans décimale ni séparateur décimal.",
      ]),
    );
  });

  it("signale en avertissement la mise à jour d'un code déjà présent", () => {
    const result = validateImportRows("partners", [row(2, partnerValues())], CONTEXT_WITH_PARTNER);

    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.status).toBe("warning");
    expect(result.rows[0]?.warnings).toContain(
      "Code déjà présent : la ligne mettra à jour le tiers existant.",
    );
  });

  it("refuse un code présent plusieurs fois dans le fichier", () => {
    const result = validateImportRows("partners", [
      row(2, partnerValues({ code: "CLI001" })),
      row(3, partnerValues({ code: "cli001", nom: "Doublon" })),
    ]);

    expect(result.errorCount).toBe(2);
    expect(result.rows[0]?.errors.join(" ")).toContain("présent plusieurs fois dans le fichier");
    expect(result.rows[1]?.errors.join(" ")).toContain("lignes 2, 3");
  });

  it("lit un code numérique sans le corriger silencieusement", () => {
    const result = validateImportRows("partners", [row(2, partnerValues({ code: 12345 }))]);

    expect(result.rows[0]?.code).toBe("12345");
    expect(result.rows[0]?.warnings).toEqual(
      expect.arrayContaining(["Code : valeur lue comme nombre ; formater la colonne en texte."]),
    );
  });
});

describe("ART-002 — articles", () => {
  it("accepte un produit avec un code SH existant et des prix XOF entiers", () => {
    const result = validateImportRows("articles", [row(2, articleValues())], CONTEXT_WITH_HS);

    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.rows[0]?.data).toMatchObject({
      code: "ART001",
      type: "product",
      unitCode: "KG",
      hsCode: "0901110000",
      salePriceXof: 250000,
      purchasePriceXof: 180000,
      isSellable: true,
      isPurchasable: true,
      active: true,
    });
  });

  it("refuse un prix décimal, un prix négatif et un montant hors borne", () => {
    const result = validateImportRows(
      "articles",
      [
        row(2, articleValues({ prix_vente_xof: "250000.5" })),
        row(3, articleValues({ code: "ART002", prix_achat_xof: "-1" })),
        row(4, articleValues({ code: "ART003", prix_vente_xof: String(MAX_XOF_AMOUNT + 1) })),
      ],
      CONTEXT_WITH_HS,
    );

    expect(result.errorCount).toBe(3);
    expect(result.rows[0]?.errors.join(" ")).toContain("Prix de vente XOF : nombre entier attendu");
    expect(result.rows[1]?.errors.join(" ")).toContain(
      "Prix d'achat XOF : doit être compris entre 0 et",
    );
    expect(result.rows[2]?.errors.join(" ")).toContain(
      "Prix de vente XOF : doit être compris entre 0 et",
    );
  });

  it("refuse une unité inconnue et l'absence d'usage vente ou achat", () => {
    const result = validateImportRows(
      "articles",
      [row(2, articleValues({ unite: "TONNE", vendable: "Non", achetable: "Non" }))],
      CONTEXT_WITH_HS,
    );

    expect(result.rows[0]?.status).toBe("error");
    expect(result.rows[0]?.errors).toEqual(
      expect.arrayContaining([
        "Unité : code non autorisé ; utilisez la liste du modèle.",
        "Usages : l'article doit être au moins vendable ou achetable.",
      ]),
    );
  });

  it("signale la mise à jour d'un article existant sans la bloquer", () => {
    const result = validateImportRows("articles", [row(2, articleValues())], CONTEXT_WITH_ARTICLE);

    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.status).toBe("warning");
    expect(result.rows[0]?.warnings).toContain(
      "Code déjà présent : la ligne mettra à jour l'article existant.",
    );
  });
});

describe("ART-003 — nomenclature douanière", () => {
  it("accepte un code à 6, 8 ou 10 chiffres", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "090111", libelle: "Café non torréfié" }),
      row(3, { code: "09011100", libelle: "Café non torréfié", code_parent: "090111" }),
      row(4, {
        code: "0901110000",
        libelle: "Café non torréfié, non décaféiné",
        code_parent: "09011100",
      }),
    ]);

    expect(result.errorCount).toBe(0);
    expect(result.rows.map((validated) => validated.code)).toEqual([
      "090111",
      "09011100",
      "0901110000",
    ]);
  });

  it("refuse un code non numérique ou d'une longueur interdite", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "09011A", libelle: "Invalide" }),
      row(3, { code: "0901110", libelle: "Sept chiffres" }),
    ]);

    expect(result.errorCount).toBe(2);
    expect(result.rows[0]?.errors.join(" ")).toContain("6, 8 ou 10 chiffres attendus");
    expect(result.rows[1]?.errors.join(" ")).toContain("6, 8 ou 10 chiffres attendus");
  });

  it("refuse un parent qui n'est pas un préfixe strict", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "0901110000", libelle: "Café", code_parent: "0901110000" }),
      row(3, { code: "09011100", libelle: "Café", code_parent: "090200" }),
    ]);

    expect(result.errorCount).toBe(2);
    expect(result.rows[0]?.errors).toContain(
      "Code parent : doit être un préfixe strict du code SH.",
    );
    expect(result.rows[1]?.errors).toContain(
      "Code parent : doit être un préfixe strict du code SH.",
    );
  });

  it("accepte un parent présent dans le fichier, quelle que soit sa ligne", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "09011100", libelle: "Café non torréfié", code_parent: "090111" }),
      row(3, { code: "090111", libelle: "Café" }),
    ]);

    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.status).toBe("valid");
  });

  it("accepte un parent déjà présent dans le référentiel", () => {
    const result = validateImportRows(
      "hs_codes",
      [row(2, { code: "09011100", libelle: "Café non torréfié", code_parent: "090111" })],
      {
        ...EMPTY_VALIDATION_CONTEXT,
        existingHsCodes: new Map([["090111", "Café non torréfié"]]),
      },
    );

    expect(result.errorCount).toBe(0);
  });

  it("refuse un parent introuvable dans le fichier et dans le référentiel", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "09011100", libelle: "Café non torréfié", code_parent: "090111" }),
    ]);

    expect(result.rows[0]?.errors).toContain(
      "Code parent 090111 introuvable dans la nomenclature ni dans ce fichier.",
    );
  });

  it("refuse deux lignes portant le même code", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "0901110000", libelle: "Café" }),
      row(3, { code: "0901110000", libelle: "Doublon" }),
    ]);

    expect(result.errorCount).toBe(2);
    expect(result.rows[0]?.errors.join(" ")).toContain("présent plusieurs fois");
  });

  it("signale un code lu comme nombre", () => {
    const parsed = hsCodeField(9011100000, true);

    expect(parsed.value).toBe("9011100000");
    expect(parsed.warnings).toContain(
      "Code SH : valeur lue comme nombre ; formater la colonne en texte.",
    );
  });

  it("accepte les bandes TEC UEMOA et retire un signe pourcentage", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "090111", libelle: "Café", taux_tec: "0" }),
      row(3, { code: "170199", libelle: "Sucre", taux_tec: "5" }),
      row(4, { code: "010121", libelle: "Chevaux", taux_tec: "10%" }),
      row(5, { code: "240220", libelle: "Tabac", taux_tec: "20" }),
      row(6, { code: "220300", libelle: "Bière", taux_tec: "35" }),
    ]);

    expect(result.errorCount).toBe(0);
    expect(
      result.rows.map((validated) => (validated.data as { tecRate: number | null }).tecRate),
    ).toEqual([0, 5, 10, 20, 35]);
    expect(result.rows[2]?.warnings).toContain("Taux TEC : signe pourcentage retiré.");
  });

  it("refuse une bande TEC hors 0, 5, 10, 20 et 35", () => {
    const result = validateImportRows("hs_codes", [
      row(2, { code: "090111", libelle: "Café", taux_tec: "12" }),
      row(3, { code: "170199", libelle: "Sucre", taux_tec: "7,5" }),
    ]);

    expect(result.errorCount).toBe(2);
    expect(result.rows[0]?.errors).toContain("Taux TEC : bande UEMOA 0, 5, 10, 20 ou 35 attendue.");
  });

  it("conserve le taux TEC existant quand la colonne est vide", () => {
    const result = validateImportRows(
      "hs_codes",
      [row(2, { code: "090111", libelle: "Café", taux_tec: "" })],
      {
        ...EMPTY_VALIDATION_CONTEXT,
        existingHsCodes: new Map([["090111", "Café non torréfié"]]),
      },
    );

    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.warnings).toContain(
      "Taux TEC vide : le taux déjà enregistré est conservé.",
    );
  });
});

describe("ART-004 — lien entre article et nomenclature", () => {
  it("refuse un produit sans code SH", () => {
    const result = validateImportRows(
      "articles",
      [row(2, articleValues({ code_sh: "" }))],
      CONTEXT_WITH_HS,
    );

    expect(result.rows[0]?.errors).toContain("Code SH : obligatoire pour un produit.");
  });

  it("refuse un produit dont le code SH est inconnu", () => {
    const result = validateImportRows(
      "articles",
      [row(2, articleValues({ code_sh: "9999990000" }))],
      CONTEXT_WITH_HS,
    );

    expect(result.rows[0]?.errors).toContain(
      "Code SH 9999990000 inconnu : importez d'abord la nomenclature douanière.",
    );
  });

  it("accepte un service sans code SH", () => {
    const result = validateImportRows(
      "articles",
      [
        row(2, {
          code: "SRV001",
          designation: "Transport routier",
          type: "Service",
          unite: "H",
          code_sh: "",
        }),
      ],
      CONTEXT_WITH_HS,
    );

    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.data).toMatchObject({ type: "service", hsCode: null });
  });

  it("refuse un service qui porte un code SH", () => {
    const result = validateImportRows(
      "articles",
      [row(2, articleValues({ type: "Service" }))],
      CONTEXT_WITH_HS,
    );

    expect(result.rows[0]?.errors).toContain("Type service : le code SH doit rester vide.");
  });
});

describe("ART-005 — vérification ligne à ligne sans correction silencieuse", () => {
  it("agrège les avertissements de normalisation sans bloquer la ligne", () => {
    const result = validateImportRows("partners", [
      row(
        2,
        partnerValues({
          code: " cli001 ",
          email: "CONTACT@EXAMPLE.COM",
          pays: "sn",
        }),
      ),
    ]);

    const warnings = result.rows[0]?.warnings ?? [];
    expect(result.errorCount).toBe(0);
    expect(result.rows[0]?.status).toBe("warning");
    expect(warnings).toEqual(
      expect.arrayContaining([
        "Code : espaces de début ou de fin retirés.",
        "Code : normalisé en majuscules.",
        "E-mail : normalisé en minuscules.",
        "Pays : normalisé en majuscules.",
      ]),
    );
    expect(result.rows[0]?.data).toMatchObject({
      code: "CLI001",
      email: "contact@example.com",
      countryCode: "SN",
    });
  });

  it("compte erreurs et avertissements séparément et applique le statut le plus grave", () => {
    const result = validateImportRows("partners", [
      row(2, partnerValues({ code: "cli001" })),
      row(3, partnerValues({ code: "CLI002", nom: "" })),
    ]);

    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.rows[0]?.status).toBe("warning");
    expect(result.rows[1]?.status).toBe("error");
  });
});
