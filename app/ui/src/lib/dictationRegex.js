// Dictation regex rules: parse the served CSVs (Murmure's regex.csv by
// default, see docker/entrypoint.sh) and apply them to a transcript.
//
// Pure functions, moved out of App.jsx so the dictation-commands popup can run
// the SAME rules over its candidate phrases (dictationCommands.js) and so the
// parsing is unit-testable in Node.
//
// Written with the help of Claude Code.

// Simple CSV line parser that handles quoted fields with commas. Commas inside
// a [...] character class are kept too, so an unquoted regex like
// [.,?!;\s]* is not split into several fields.
export function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let bracketDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (!inQuotes && ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += ch;
    } else if (ch === ',' && !inQuotes && bracketDepth === 0) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Split CSV text into records, keeping a newline that sits inside a quoted
 * field as part of its record (Murmure's "ajoute la commande X" templates have
 * multi-line replacements). Each record carries the 1-based line it starts on,
 * for warnings. A doubled quote ("") toggles twice, so it stays inside.
 * @param {string} text
 * @returns {{text: string, line: number}[]}
 */
export function splitCSVRecords(text) {
  const records = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '\n') {
      if (!inQuotes) {
        records.push({ text: text.slice(start, i).replace(/\r$/, ''), line: startLine });
        start = i + 1;
        startLine = line + 1;
      }
      line++;
    }
  }
  if (start < text.length) records.push({ text: text.slice(start).replace(/\r$/, ''), line: startLine });
  return records;
}

/**
 * Parse one dictation CSV into rules.
 * @param {string} csvText
 * @param {string} source Rule origin label (file name without .csv).
 * @param {(msg: string) => void} [warn]
 * @returns {{regex: string, flags: string, replacement: string, source: string}[]}
 */
export function parseDictationCsv(csvText, source, warn = () => {}) {
  const rules = [];
  const records = splitCSVRecords(csvText.trim());
  // Parse header to find column indices
  const headerText = records[0]?.text ?? '';
  const header = parseCSVLine(headerText.trim()).map(h => h.trim().toLowerCase());
  const regexIdx = header.indexOf('regex');
  const replacementIdx = header.indexOf('remplacement') !== -1 ? header.indexOf('remplacement') : header.indexOf('replacement');
  if (regexIdx === -1 || replacementIdx === -1) {
    warn(`could not find 'regex' and 'remplacement' columns in header: ${headerText}`);
    return rules;
  }
  for (let r = 1; r < records.length; r++) {
    const line = records[r].text.trim();
    const lineNo = records[r].line;
    if (!line || line === ',,') continue;
    const fields = parseCSVLine(line);
    const rawRegex = fields[regexIdx] ?? '';
    const rawReplacement = fields[replacementIdx] ?? '';
    if (!rawRegex) continue;
    try {
      // Extract Python-style inline flags (e.g. (?i), (?ims)) from the
      // pattern and translate to JS RegExp flags so case-sensitive
      // rules don't silently become insensitive.
      let parsedFlags = '';
      const cleanedRegex = rawRegex.replace(/\(\?([gimsuy]+)\)/g, (_, fl) => {
        parsedFlags += fl;
        return '';
      });
      // Default to case-insensitive when no flags specified (preserves
      // historical behaviour for rules that omit (?i)).
      const jsFlags = 'g' + (parsedFlags
        ? [...new Set(parsedFlags.split(''))].filter(f => 'imsuy'.includes(f)).join('')
        : 'i');
      new RegExp(cleanedRegex, jsFlags);
      const replacement = rawReplacement
        .replace(/\\n/g, '\n') // support \n in replacements
        .replace(/^"(.*)"$/, '$1'); // strip outer quotes
      // Refuse replacements containing C0/C1 controls (ESC, BEL,
      // backspace, OSC introducer) and bidi-override codepoints.
      // The auto-copy-to-clipboard path writes this directly into
      // the user's system clipboard; a tampered upstream CSV
      // could otherwise smuggle ANSI/OSC sequences that execute
      // on paste-to-terminal in shells without bracketed-paste.
      // Tab and newline are kept explicitly because they are
      // legitimate replacement content.
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩]/.test(replacement)) {
        warn(`Rejecting rule at line ${lineNo}: replacement contains control or bidi characters`);
        continue;
      }
      rules.push({ regex: cleanedRegex, flags: jsFlags, replacement, source });
    } catch (e) {
      warn(`Invalid regex at line ${lineNo}: regex="${rawRegex}" replacement="${rawReplacement}" error=${e.message}`);
    }
  }
  return rules;
}

/**
 * Apply dictation rules in order, then trim every line and capitalize its
 * first letter.
 * @param {string} text
 * @param {{regex: string, flags?: string, replacement: string}[]} rules
 * @returns {string}
 */
export function applyDictationRules(text, rules) {
  if (!rules.length || !text) return text;
  let result = text;
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.regex, rule.flags || 'gi');
      result = result.replace(re, rule.replacement);
    } catch (e) {
      // Skip invalid regex at runtime
    }
  }
  return result
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return trimmed;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    })
    .join('\n');
}
