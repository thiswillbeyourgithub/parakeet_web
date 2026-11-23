// Tier-1 unit tests for the "Dictation commands" popup content
// (lib/dictationCommands.js). The rule engine itself is covered in
// dictation-regex.test.mjs.
//
// The popup lists curated phrases but must only show the ones the LOADED rules
// really turn into the target, so most cases here check that filter against
// small synthetic rule sets. The last case runs every curated phrase through
// the real Murmure regex.csv when a local checkout is present (framagit_murmure/
// is gitignored, so it self-skips elsewhere): a phrase that stopped working
// upstream should be noticed, not silently dropped from the popup.
//
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { parseDictationCsv } from '../../app/ui/src/lib/dictationRegex.js';
import { DICTATION_COMMANDS, workingDictationCommands, formWorks } from '../../app/ui/src/lib/dictationCommands.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const NEWLINE = { regex: '\\s*(?:retour\\s+)?à\\s+la\\s+ligne\\s*', flags: 'gi', replacement: '\n' };
const COMMA = { regex: '\\s*virgule\\s*', flags: 'gi', replacement: ', ' };

test('workingDictationCommands keeps only phrases the rules handle', () => {
  const cmds = workingDictationCommands([NEWLINE, COMMA]);
  assert.deepEqual(cmds.map(c => c.target), ['↵', ',']);
  const nl = cmds[0];
  assert.deepEqual(nl.working, ['retour à la ligne', 'à la ligne']);
  assert.equal(nl.recommended, 'retour à la ligne');
});

test('no rules means no table', () => {
  assert.deepEqual(workingDictationCommands([]), []);
  assert.deepEqual(workingDictationCommands(undefined), []);
});

test('a working fallback is never bolded in place of a broken recommendation', () => {
  const onlyBare = { regex: '\\s*(?<!retour )à\\s+la\\s+ligne\\s*', flags: 'gi', replacement: '\n' };
  const [nl] = workingDictationCommands([onlyBare]);
  assert.equal(nl.working[0], 'à la ligne');
  assert.equal(nl.recommended, null);
});

test('a phrase is not "working" when the output lacks the expected text', () => {
  const wrong = { regex: '\\s*virgule\\s*', flags: 'gi', replacement: '; ' };
  const comma = DICTATION_COMMANDS.find(c => c.target === ',');
  assert.equal(formWorks('virgule', comma, [wrong]), false);
  assert.equal(formWorks('virgule', comma, [COMMA]), true);
});

test('every curated row has at least one form and a known group', () => {
  const groups = new Set(['dictCmdGroupLayout', 'dictCmdGroupPunctuation', 'dictCmdGroupAbbreviations']);
  for (const c of DICTATION_COMMANDS) {
    assert.ok(c.forms.length > 0, c.target);
    assert.ok(groups.has(c.group), c.group);
  }
});

// Rough French sound key: endings that are spelled differently but sound the
// same collapse together ("fermer"/"fermez"/"fermé" -> "fermé", silent plural
// and final consonants dropped: "nouveaux tirets" -> "nouveau tire").
const soundKey = form => form.toLowerCase().split(/\s+/).map(w => w
  .replace(/(?:er|ez|ées?|és?)$/, 'é')
  .replace(/[sxz]$/, '')
  .replace(/[td]$/, '')).join(' ');

test('a row never lists two forms that sound the same', () => {
  assert.equal(soundKey('nouveaux tirets'), soundKey('nouveau tiret'));
  assert.equal(soundKey('fermer la parenthèse'), soundKey('fermez la parenthèse'));
  assert.notEqual(soundKey('ouvrir la parenthèse'), soundKey('ouvrez la parenthèse'));
  for (const c of DICTATION_COMMANDS) {
    const keys = c.forms.map(soundKey);
    assert.equal(new Set(keys).size, keys.length, `${c.target}: ${c.forms.join(' / ')}`);
  }
});

const MURMURE =resolve(root, 'framagit_murmure/regex.csv');
test('every curated phrase works with the local Murmure regex.csv', { skip: !existsSync(MURMURE) && 'framagit_murmure/regex.csv not present' }, () => {
  const rules = parseDictationCsv(readFileSync(MURMURE, 'utf8'), 'regex');
  const broken = DICTATION_COMMANDS.flatMap(c => c.forms.filter(f => !formWorks(f, c, rules)));
  assert.deepEqual(broken, []);
});
