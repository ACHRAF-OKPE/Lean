import { normalizeReferenceLabel } from "@/lib/references";

/** ART-017 — un code SH compte 6, 8 ou 10 chiffres. */
export const HS_CODE_PATTERN = /^\d{6}(\d{2}(\d{2})?)?$/;

export type HsLevel = 6 | 8 | 10;

/** ART-017 — la longueur du code dit son niveau : position (6), sous-position (8), ligne (10). */
export function hsLevel(code: string): HsLevel | null {
  return HS_CODE_PATTERN.test(code) ? (code.length as HsLevel) : null;
}

/** ART-018 — les parents candidats, du plus proche au plus lointain (0901110000 donne 09011100 puis 090111). */
export function parentCandidates(code: string): readonly string[] {
  if (!HS_CODE_PATTERN.test(code)) {
    return [];
  }
  const candidates: string[] = [];
  if (code.length >= 8) {
    candidates.push(code.slice(0, code.length - 2));
  }
  if (code.length === 10) {
    candidates.push(code.slice(0, 6));
  }
  return candidates;
}

/** ART-018 — le parent retenu par défaut : le préfixe strict le plus proche. */
export function deriveParentCode(code: string): string | null {
  return parentCandidates(code)[0] ?? null;
}

/** ART-018 — les parents absents à créer pour loger un code, du plus lointain au plus proche. */
export function missingParentCodes(code: string, existing: ReadonlySet<string>): readonly string[] {
  return parentCandidates(code)
    .filter((candidate) => !existing.has(candidate))
    .reverse();
}

/** ART-018 — un parent créé automatiquement porte ce libellé, à compléter plus tard. */
export const HS_WORDING_TO_COMPLETE = "À compléter";

export interface HsParentFacts {
  readonly supplementaryUnit: string | null;
  readonly tecRate: number | null;
}

/** ART-018 — l'enfant hérite de l'unité complémentaire et du taux TEC du parent le plus proche trouvé. */
export function inheritanceFor(
  code: string,
  parentsByCode: ReadonlyMap<string, HsParentFacts>,
): { readonly parentCode: string | null } & HsParentFacts {
  for (const candidate of parentCandidates(code)) {
    const parent = parentsByCode.get(candidate);
    if (parent) {
      return {
        parentCode: candidate,
        supplementaryUnit: parent.supplementaryUnit,
        tecRate: parent.tecRate,
      };
    }
  }
  return { parentCode: null, supplementaryUnit: null, tecRate: null };
}

export interface HsCodeOption {
  readonly id: string;
  readonly code: string;
  readonly wording: string;
  readonly tecRate: number | null;
}

export type HsRefState =
  | { readonly kind: "empty" }
  | { readonly kind: "match"; readonly option: HsCodeOption }
  | { readonly kind: "create"; readonly code: string }
  | { readonly kind: "refused"; readonly code: string };

/** ART-017 — le champ guidé reconnaît un code saisi, ou son libellé exact, et propose la création sinon. */
export function resolveHsRef(
  query: string,
  options: readonly HsCodeOption[],
  canCreate: boolean,
): HsRefState {
  const raw = query.trim();
  if (raw === "") {
    return { kind: "empty" };
  }

  const byCode = options.find((option) => option.code === raw);
  if (byCode) {
    return { kind: "match", option: byCode };
  }

  const label = normalizeReferenceLabel(raw);
  const byWording = options.find((option) => normalizeReferenceLabel(option.wording) === label);
  if (byWording) {
    return { kind: "match", option: byWording };
  }

  return canCreate ? { kind: "create", code: raw } : { kind: "refused", code: raw };
}

/** ART-017 — le code ou le libellé contient la saisie : les suggestions les plus proches d'abord. */
export function suggestHsCodes(
  query: string,
  options: readonly HsCodeOption[],
  limit = 8,
): readonly HsCodeOption[] {
  const raw = query.trim();
  const label = normalizeReferenceLabel(raw);
  if (raw === "") {
    return options.slice(0, limit);
  }
  return options
    .filter(
      (option) =>
        option.code.includes(raw) || normalizeReferenceLabel(option.wording).includes(label),
    )
    .slice(0, limit);
}

/** ART-018 — deux codes au libellé identique : l'alerte est écrite, la création reste permise. */
export function wordingTwins(
  wording: string,
  options: readonly HsCodeOption[],
): readonly HsCodeOption[] {
  const label = normalizeReferenceLabel(wording);
  if (label === "") {
    return [];
  }
  return options.filter((option) => normalizeReferenceLabel(option.wording) === label);
}

/** ART-017 — ce que le champ affiche à côté d'un code : son libellé, jamais un tiret cadratin. */
export function hsCodeSuggestionText(option: HsCodeOption): string {
  if (option.wording === "") {
    return option.code;
  }
  return `${option.code} · ${option.wording}`;
}

/** ART-019 — ce que le registre affiche à côté d'un code : son usage en documents et en enfants. */
export function hsUsageLabel(usage: {
  readonly articles: number;
  readonly declarationLines: number;
  readonly children: number;
}): string {
  const parts: string[] = [];
  if (usage.articles > 0) {
    parts.push(`${usage.articles} article${usage.articles > 1 ? "s" : ""}`);
  }
  if (usage.declarationLines > 0) {
    parts.push(`${usage.declarationLines} ligne${usage.declarationLines > 1 ? "s" : ""} de douane`);
  }
  if (usage.children > 0) {
    parts.push(`${usage.children} enfant${usage.children > 1 ? "s" : ""}`);
  }
  return parts.length === 0 ? "Libre" : parts.join(" · ");
}

/** ART-018 — ce que la création à la volée rend au champ guidé : le code créé et la chaîne de parents. */
export interface HsCodeCreateResult {
  readonly ok: boolean;
  readonly option?: HsCodeOption;
  readonly created?: readonly string[];
  readonly error?: string;
}
