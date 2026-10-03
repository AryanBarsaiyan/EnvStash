import type { EnvVar } from '../model';

export type DiffStatus = 'different' | 'onlyLeft' | 'onlyRight' | 'same';

/** One key across two environments. `left`/`right` are absent where the key does not exist. */
export interface DiffRow { key: string; status: DiffStatus; left?: string; right?: string; }

/**
 * Compares two variable lists by key. Rows follow the left list's order, then the
 * keys only the right list has, so the result reads like the environment being viewed.
 */
export function diffVars(left: EnvVar[], right: EnvVar[]): DiffRow[] {
  const rightByKey = new Map<string, string>();
  for (const v of right) if (!rightByKey.has(v.key)) rightByKey.set(v.key, v.value);

  const rows: DiffRow[] = [];
  const seen = new Set<string>();
  for (const v of left) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    if (!rightByKey.has(v.key)) {
      rows.push({ key: v.key, status: 'onlyLeft', left: v.value });
    } else {
      const other = rightByKey.get(v.key)!;
      rows.push({ key: v.key, status: other === v.value ? 'same' : 'different', left: v.value, right: other });
    }
  }
  for (const [key, value] of rightByKey) {
    if (!seen.has(key)) rows.push({ key, status: 'onlyRight', right: value });
  }
  return rows;
}
