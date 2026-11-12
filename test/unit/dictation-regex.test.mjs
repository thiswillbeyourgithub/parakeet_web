// Tier-1 unit tests for the dictation rule engine (lib/dictationRegex.js):
// CSV parsing (quoted fields, multi-line quoted replacements, inline flags,
// control characters refused) and rule application.
//
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSVLine, splitCSVRecords, parseDictationCsv, applyDictationRules } from '../../app/ui/src/lib/dictationRegex.js';

test('parseCSVLine keeps commas inside quotes and character classes', () => {
  assert.deepEqual(parseCSVLine('a,"b,c",[.,;]*x'), ['a', 'b,c', '[.,;]*x']);
  assert.deepEqual(parseCSVLine('"say ""hi""",z'), ['say "hi"', 'z']);
});

test('parseDictationCsv: inline flags, \\n replacements, control chars refused', () => {
  const warnings = [];
  const rules = parseDictationCsv(
    'id,remplacement,regex\n'
    + 'a,\\n,(?i)\\s*retour à la ligne\\s*\n'
    + 'b,X,Case\n'
    + 'c,"\x1b[31m",evil\n',
    'src', w => warnings.push(w));
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], { regex: '\\s*retour à la ligne\\s*', flags: 'gi', replacement: '\n', source: 'src' });
  assert.equal(rules[1].flags, 'gi', 'no inline flag keeps the historical case-insensitive default');
  assert.equal(warnings.length, 1);
});

test('parseDictationCsv keeps a multi-line quoted replacement as ONE rule', () => {
  // Murmure's "ajoute la commande X" templates span several lines. Splitting
  // the file on newlines first used to drop the template and turn each of its
  // lines into a bogus rule of its own.
  const csv = 'id,remplacement,regex\n'
    + 't,"Ligne 1\nLigne 2, suite\n""cité""",(?i)ajoute la commande test\n'
    + 'v,", ",(?i)\\s*virgule\\s*\n';
  const rules = parseDictationCsv(csv, 'src');
  assert.equal(rules.length, 2);
  assert.equal(rules[0].replacement, 'Ligne 1\nLigne 2, suite\n"cité"');
  assert.equal(applyDictationRules('ajoute la commande test', rules), 'Ligne 1\nLigne 2, suite\n"cité"');
});

test('splitCSVRecords reports the line each record starts on', () => {
  assert.deepEqual(splitCSVRecords('h\r\na,"x\ny"\nb'), [
    { text: 'h', line: 1 }, { text: 'a,"x\ny"', line: 2 }, { text: 'b', line: 4 },
  ]);
});

test('parseDictationCsv refuses a file without regex/remplacement columns', () => {
  const warnings = [];
  assert.deepEqual(parseDictationCsv('foo,bar\n1,2\n', 'src', w => warnings.push(w)), []);
  assert.equal(warnings.length, 1);
});

test('applyDictationRules trims and capitalizes each line', () => {
  const rules = [{ regex: '\\s*à la ligne\\s*', flags: 'gi', replacement: '\n' }];
  assert.equal(applyDictationRules('bonjour à la ligne au revoir', rules), 'Bonjour\nAu revoir');
  assert.equal(applyDictationRules('', rules), '');
});
