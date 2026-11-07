import { describe, expect, it } from "vitest";
import { validatePartnerBankAccount } from "./partner-bank-account";

describe("ART-024 — coordonnées bancaires fournisseur", () => {
  it("accepte un compte UEMOA avec RIB, un IBAN valide et un BIC", () => {
    const result = validatePartnerBankAccount({
      bank_name: "Banque du Sahel",
      bank_country_code: "CI",
      account_holder: "Sahel Distribution SARL",
      bank_code: "CI001",
      branch_code: "01001",
      account_number: "12345678901",
      rib_key: "23",
      iban: "CI93CI0080111301134291200589",
      bic: "BNPAFRPP",
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({ bankCountryCode: "CI", ribKey: "23", bic: "BNPAFRPP" });
  });

  it("refuse une fiche bancaire partielle ou des identifiants mal formés", () => {
    const result = validatePartnerBankAccount({
      bank_name: "Banque",
      account_holder: "",
      account_number: "",
      iban: "CI00CI0080111301134291200589",
      rib_key: "234",
      bic: "BIC!",
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Clé RIB : 2 caractères maximum.",
        "L'IBAN est invalide (format ou clé de contrôle).",
        "Le BIC / SWIFT contient 8 ou 11 caractères alphanumériques.",
        "Renseignez l'intitulé du compte bancaire.",
      ]),
    );
  });

  it("permet de vider toutes les coordonnées sans les rendre obligatoires pour un tiers", () => {
    const result = validatePartnerBankAccount({});
    expect(result.errors).toEqual([]);
    expect(result.data.accountNumber).toBeNull();
  });
});
