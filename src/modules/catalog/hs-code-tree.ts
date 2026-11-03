/** ART-020 — un code se lit par son préfixe : le chapitre tient les deux premiers chiffres. */
export function hsChapter(code: string): string {
  return code.slice(0, 2);
}

/** ART-020 — une position de tête (6 chiffres) et les lignes plus fines rangées dessous. */
export interface HsTreeGroup<T> {
  readonly key: string;
  readonly heading: T | null;
  readonly rows: readonly T[];
}

export interface HsTreeChapter<T> {
  readonly chapter: string;
  readonly groups: readonly HsTreeGroup<T>[];
}

/**
 * ART-020 — la vue hiérarchique range le jeu filtré en chapitres, puis en positions de tête, puis en
 * lignes plus fines. Aucune ligne n'est perdue : une position absente du jeu laisse son groupe sans tête.
 */
export function groupHsCodesByChapter<T extends { readonly code: string }>(
  rows: readonly T[],
): readonly HsTreeChapter<T>[] {
  const chapters = new Map<string, Map<string, { heading: T | null; rows: T[] }>>();

  for (const row of rows) {
    const chapter = hsChapter(row.code);
    const key = row.code.slice(0, 6);
    const groups = chapters.get(chapter) ?? new Map<string, { heading: T | null; rows: T[] }>();
    const group = groups.get(key) ?? { heading: null, rows: [] };
    if (row.code === key) {
      group.heading = row;
    } else {
      group.rows.push(row);
    }
    groups.set(key, group);
    chapters.set(chapter, groups);
  }

  return [...chapters.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([chapter, groups]) => ({
      chapter,
      groups: [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, group]) => ({
          key,
          heading: group.heading,
          rows: [...group.rows].sort((a, b) => a.code.localeCompare(b.code)),
        })),
    }));
}
