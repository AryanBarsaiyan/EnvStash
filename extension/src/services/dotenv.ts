// ── .env parsing ──────────────────────────────────────────────────
// Supports KEY=value, export KEY=value, quoted values (multi-line allowed) and # comments
export function parseDotenv(text: string): { key: string; value: string }[] {
  const lines = text.split(/\r?\n/);
  const parsedVars: { key: string; value: string }[] = [];
  let currentKey: string | null = null;
  let currentValue = '';
  let inQuotes: '"' | "'" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentKey !== null && inQuotes !== null) {
      const closingIdx = line.indexOf(inQuotes);
      if (closingIdx !== -1) {
        currentValue += '\n' + line.slice(0, closingIdx);
        const finalVal = inQuotes === '"' ? currentValue.replace(/\\n/g, '\n') : currentValue;
        parsedVars.push({ key: currentKey, value: finalVal });
        currentKey = null;
        currentValue = '';
        inQuotes = null;
      } else {
        currentValue += '\n' + line;
      }
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    let key = trimmed.slice(0, eq).trim();
    if (key.toLowerCase().startsWith('export ')) {
      key = key.slice(7).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawVal = trimmed.slice(eq + 1).trim();
    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      const q = rawVal[0] as '"' | "'";
      const closingIdx = rawVal.indexOf(q, 1);
      if (closingIdx !== -1) {
        const val = rawVal.slice(1, closingIdx);
        const finalVal = q === '"' ? val.replace(/\\n/g, '\n') : val;
        parsedVars.push({ key, value: finalVal });
      } else {
        currentKey = key;
        currentValue = rawVal.slice(1);
        inQuotes = q;
      }
    } else {
      let val = rawVal;
      const hashIdx = rawVal.indexOf('#');
      if (hashIdx !== -1) {
        val = rawVal.slice(0, hashIdx).trim();
      }
      parsedVars.push({ key, value: val });
    }
  }
  return parsedVars;
}
