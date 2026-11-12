// The spoken commands of Dictation mode, for the "Dictation commands" popup.
//
// The dictation rules are regexes (Murmure's regex.csv by default), which say
// what the rules MATCH but not what a person should SAY, and they also absorb
// the model's own mishearings ("sceau une ligne", "viandule"). So the phrases
// a person should use are curated here, with the recommended one first.
//
// A curated list can drift from the rules actually served (a deployment can
// point DICTATION_REGEX_SOURCE at another CSV, and upstream can change), so it
// is never shown raw: workingDictationCommands() runs every phrase through the
// LOADED rules and keeps only those that really produce the target. The popup
// therefore cannot advertise a phrase that does nothing on this deployment.
//
// Written with the help of Claude Code.
import { applyDictationRules } from './dictationRegex.js';

/**
 * @typedef {object} DictationCommand
 * @property {string} group i18n key of the table section.
 * @property {string} target What the user wants, shown in the first column.
 * @property {string} [targetKey] i18n key describing an invisible target (newline...).
 * @property {string[]} forms Ways to say it, the RECOMMENDED one first.
 * @property {string} [expect] Text the output must contain for a form to count.
 * @property {boolean} [noRecommended] All forms are equivalent, bold none.
 */

const LAYOUT = 'dictCmdGroupLayout';
const PUNCT = 'dictCmdGroupPunctuation';
const ABBREV = 'dictCmdGroupAbbreviations';
const TEMPLATE = 'dictCmdGroupTemplates';

/** @type {DictationCommand[]} */
export const DICTATION_COMMANDS = [
  { group: LAYOUT, target: '↵', targetKey: 'dictCmdNewline', expect: '\n', forms: ['retour à la ligne', 'à la ligne', 'aller à la ligne', 'saute une ligne'] },
  { group: LAYOUT, target: '↵↵', targetKey: 'dictCmdBlankLine', expect: '\n\n', forms: ['saut de ligne'] },
  { group: LAYOUT, target: '- ', targetKey: 'dictCmdListDash', expect: '-', forms: ['nouveau tiret', 'nouveaux tirets'] },
  { group: PUNCT, target: ',', expect: ',', forms: ['virgule'] },
  { group: PUNCT, target: '.', expect: '.', forms: ['point', 'point final'] },
  { group: PUNCT, target: ';', expect: ';', forms: ['point virgule'] },
  { group: PUNCT, target: ':', expect: ':', forms: ['deux points'] },
  { group: PUNCT, target: '?', expect: '?', forms: ["point d'interrogation"] },
  { group: PUNCT, target: '!', expect: '!', forms: ["point d'exclamation"] },
  { group: PUNCT, target: '...', expect: '...', forms: ['points de suspension', 'trois petits points', 'trois points'] },
  { group: PUNCT, target: '-', targetKey: 'dictCmdHyphen', expect: '-', forms: ["trait d'union"] },
  { group: PUNCT, target: '"', targetKey: 'dictCmdOpenQuote', expect: '"', forms: ['ouvrez les guillemets', 'ouvrir les guillemets', 'début de citation'] },
  { group: PUNCT, target: '"', targetKey: 'dictCmdCloseQuote', expect: '"', forms: ['fermez les guillemets', 'fermer les guillemets', 'fin de citation'] },
  { group: PUNCT, target: '(', expect: '(', forms: ['ouvrez la parenthèse', 'ouvrir la parenthèse'] },
  { group: PUNCT, target: ')', expect: ')', forms: ['fermez la parenthèse', 'fermer la parenthèse'] },
  { group: PUNCT, target: '/', expect: '/', forms: ['slash'] },
  { group: PUNCT, target: '#', expect: '#', forms: ['dièse', 'hashtag'] },
  { group: ABBREV, target: 'mg/kg/j', expect: 'mg/kg/j', forms: ['15 mg par kilo par jour'] },
  { group: ABBREV, target: '/j', expect: '/j', forms: ['3 fois par jour'] },
  { group: ABBREV, target: '/sem', expect: '/sem', forms: ['3 fois par semaine'] },
  { group: ABBREV, target: '/h', expect: '/h', forms: ['3 fois par heure'] },
  { group: ABBREV, target: '/mois', expect: '/mois', forms: ['3 fois par mois'] },
  { group: ABBREV, target: '/an', expect: '/an', forms: ['3 fois par an'] },
  { group: ABBREV, target: 'matin/midi/soir', expect: 'matin/midi/soir', forms: ['matin midi et soir'] },
  { group: ABBREV, target: '%', expect: '%', forms: ['pourcent'] },
  { group: ABBREV, target: 'mg', expect: 'mg', forms: ['milligrammes'] },
  { group: ABBREV, target: 'µg', expect: 'µg', forms: ['microgrammes'] },
  { group: ABBREV, target: 'g', expect: ' g ', forms: ['grammes'] },
  { group: ABBREV, target: 'mL', expect: 'mL', forms: ['millilitres'] },
  { group: ABBREV, target: 'l/min', expect: 'l/min', forms: ['litres par minute'] },
  { group: ABBREV, target: 'UI', expect: 'UI', forms: ['unités internationales'] },
  { group: ABBREV, target: 'cp', expect: 'cp', forms: ['comprimés'] },
  { group: ABBREV, target: 'bpm', expect: 'bpm', forms: ['battements par minute'] },
  { group: ABBREV, target: 'TA : 120/80', expect: 'TA : 120/80', forms: ['tension 120 80'] },
  { group: ABBREV, target: 'SpO2 98%', expect: 'SpO2 98%', forms: ['saturation 98'] },
  { group: ABBREV, target: 'FC 75 bpm', expect: 'FC 75 bpm', forms: ['pouls 75', 'fréquence cardiaque 75'], noRecommended: true },
  { group: ABBREV, target: 'T° 38,2', expect: 'T° 38,2', forms: ['température 38 2'] },
  ...[
    'examen clinique', 'examen simplifié', 'examen anaphylaxie', 'examen infectieux',
    'examen traumatologie', 'examen traumatisme cranien', 'examen conclusion',
    "examen d'un patient alcoolisé", 'électrisation', 'drain thoracique', 'intubation',
    'luxation épaule', 'sédation procédurale', 'sortie contre avis',
    'entorse cheville droite', 'entorse cheville gauche', 'ordonnance entorse cheville',
    'ordonnance botte de marche', 'ordonnance brûlures', 'échographie urgentiste',
  ].map(name => ({ group: TEMPLATE, target: name, targetKey: 'dictCmdTemplate', forms: [`ajoute la commande ${name}`] })),
];

const norm = s => s.toLowerCase().replace(/\s+/g, ' ');
const words = s => s.toLowerCase().match(/\p{L}+/gu) ?? [];

/**
 * Does saying `form` produce the command's target under these rules? The
 * phrase is wrapped in neutral words, the way it is dictated mid-sentence, and
 * counts when the phrase is gone from the output and the expected text is in.
 * With an `expect`, every word of the phrase must also be consumed (bar the
 * ones the target itself contains, like "matin" in matin/midi/soir): a rule
 * for "à la ligne" turns "aller à la ligne" into "aller\n", which is not the
 * phrase working. Templates have no `expect` (their text may contain any word),
 * so for them the whole phrase being gone is the test.
 * @param {string} form
 * @param {DictationCommand} cmd
 * @param {object[]} rules Loaded dictation rules.
 */
export function formWorks(form, cmd, rules) {
  const input = `avant ${form} après`;
  const out = applyDictationRules(input, rules);
  if (norm(out).includes(norm(form))) return false;
  if (cmd.expect !== undefined) {
    if (!out.includes(cmd.expect)) return false;
    const left = new Set(words(out));
    const allowed = new Set([...words(cmd.expect), 'avant', 'après']);
    if (words(form).some(w => !allowed.has(w) && left.has(w))) return false;
  }
  return norm(out) !== norm(input);
}

/**
 * The commands this rule set really supports, each with only its working
 * phrases. `recommended` is the first curated form, and only when it still
 * works (bolding a fallback would recommend something the curation did not).
 * @param {object[]} rules
 * @param {DictationCommand[]} [commands]
 * @returns {(DictationCommand & {working: string[], recommended: string|null})[]}
 */
export function workingDictationCommands(rules, commands = DICTATION_COMMANDS) {
  if (!rules?.length) return [];
  const out = [];
  for (const cmd of commands) {
    const working = cmd.forms.filter(f => formWorks(f, cmd, rules));
    if (!working.length) continue;
    const recommended = !cmd.noRecommended && working[0] === cmd.forms[0] ? cmd.forms[0] : null;
    out.push({ ...cmd, working, recommended });
  }
  return out;
}
