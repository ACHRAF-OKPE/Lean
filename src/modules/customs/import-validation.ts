import type { CustomsDeclarationStatus } from "@/db/schema";
import type {
  RawImportRow,
  ValidationContext,
  ValidationResult,
  ValidatedRow,
} from "@/modules/catalog/validation";
import { validateDeclarationLine } from "./validation";

export interface CustomsDeclarationReference {
  readonly id: string;
  readonly status: CustomsDeclarationStatus;
}

export interface CustomsHsCodeReference {
  readonly id: string;
  readonly tecRate: number | null;
}

export interface CustomsDeclarationLinesReference {
  readonly hsCodes: ReadonlySet<string>;
  readonly designations: ReadonlySet<string>;
}

export interface CustomsLineImportData {
  declarationId: string;
  declarationNumber: string;
  hsCodeId: string;
  hsCode: string;
  designation: string;
  qty: string;
  unitCode: string;
  valueXof: number;
  weightKg: string | null;
  originCountry: string;
}

const DECLARATION_NUMBER_PATTERN = /^DEC-[0-9]{4}-[0-9]{4}$/;

function declarationNumberOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim().toUpperCase();
}

export function validateCustomsLineImportRows(
  rows: readonly RawImportRow[],
  context: ValidationContext,
): ValidationResult {
  const declarations = context.customsDeclarationsByNumber ?? new Map();
  const hsCodes = context.customsHsCodesByCode ?? new Map();
  const existingLines = context.customsLinesByDeclaration ?? new Map();

  const validated: ValidatedRow[] = rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const number = declarationNumberOf(row.values["numero_declaration"]);
    let declaration: CustomsDeclarationReference | undefined;
    if (!number) {
      errors.push("Numéro de déclaration : obligatoire.");
    } else if (!DECLARATION_NUMBER_PATTERN.test(number)) {
      errors.push("Numéro de déclaration : format DEC-AAAA-NNNN attendu (ex. DEC-2026-0001).");
    } else {
      declaration = declarations.get(number);
      if (!declaration) {
        errors.push(`Déclaration ${number} introuvable dans cet espace.`);
      } else if (declaration.status !== "draft") {
        errors.push(
          `Déclaration ${number} non modifiable : seules les déclarations en brouillon acceptent des lignes.`,
        );
      }
    }

    const line = validateDeclarationLine({
      hsCode: row.values["code_sh"],
      designation: row.values["designation"],
      quantity: row.values["quantite"],
      unitCode: row.values["unite"],
      valueXof: row.values["valeur_xof"],
      weightKg: row.values["poids_kg"],
      originCountry: row.values["pays_origine"],
    });
    errors.push(...line.errors);
    warnings.push(...line.warnings);

    let hsCode: CustomsHsCodeReference | undefined;
    if (line.data) {
      hsCode = hsCodes.get(line.data.hsCode);
      if (!hsCode) {
        errors.push(
          `Code SH ${line.data.hsCode} inconnu : importez d'abord la nomenclature douanière.`,
        );
      } else if (hsCode.tecRate === null) {
        warnings.push(
          `Code SH ${line.data.hsCode} sans taux TEC : la déclaration ne pourra pas être liquidée tant que le taux manque.`,
        );
      }
    }

    const declared = declaration ? existingLines.get(declaration.id) : undefined;
    if (declared && line.data) {
      if (declared.hsCodes.has(line.data.hsCode)) {
        warnings.push(
          `Code SH ${line.data.hsCode} déjà déclaré sur cette déclaration : vérifiez qu'il ne s'agit pas d'un doublon.`,
        );
      }
      if (declared.designations.has(line.data.designation)) {
        warnings.push(
          "Désignation déjà déclarée sur cette déclaration : vérifiez qu'il ne s'agit pas d'un doublon.",
        );
      }
    }

    const data: CustomsLineImportData = {
      declarationId: declaration?.id ?? "",
      declarationNumber: number,
      hsCodeId: hsCode?.id ?? "",
      hsCode: line.data?.hsCode ?? "",
      designation: line.data?.designation ?? "",
      qty: line.data?.quantity ?? "",
      unitCode: line.data?.unitCode ?? "",
      valueXof: line.data?.valueXof ?? 0,
      weightKg: line.data?.weightKg ?? null,
      originCountry: line.data?.originCountry ?? "",
    };

    return {
      rowNumber: row.rowNumber,
      status: "valid",
      code: number || null,
      errors,
      warnings,
      data: { ...data },
    };
  });

  const countsByDeclaration = new Map<string, number>();
  for (const row of validated) {
    if (row.errors.length > 0) {
      continue;
    }
    const data = row.data as unknown as CustomsLineImportData;
    countsByDeclaration.set(
      data.declarationNumber,
      (countsByDeclaration.get(data.declarationNumber) ?? 0) + 1,
    );
  }

  const notes: string[] = [];
  if (countsByDeclaration.size > 0) {
    const labels = [...countsByDeclaration.entries()]
      .slice(0, 5)
      .map(([number, count]) => `${number} (${count} ligne${count > 1 ? "s" : ""})`);
    const extra =
      countsByDeclaration.size > labels.length
        ? ` et ${countsByDeclaration.size - labels.length} autre(s)`
        : "";
    const plural = countsByDeclaration.size > 1;
    notes.push(
      `${countsByDeclaration.size} déclaration${plural ? "s" : ""} en brouillon ${plural ? "recevront" : "recevra"} des lignes à la confirmation : ${labels.join(" ; ")}${extra}.`,
    );
  }

  for (const row of validated) {
    row.status = row.errors.length > 0 ? "error" : row.warnings.length > 0 ? "warning" : "valid";
  }

  return {
    rows: validated,
    errorCount: validated.filter((row) => row.status === "error").length,
    warningCount: validated.filter((row) => row.status === "warning").length,
    notes,
  };
}
