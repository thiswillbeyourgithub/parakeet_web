// "Dictation commands" popup: what to say to get each punctuation mark, line
// break, abbreviation or template in Dictation view. Opened from the main
// screen and from the settings sidebar (App.jsx owns the open state).
//
// The rows come from workingDictationCommands(), i.e. the curated phrases
// filtered against the rules this instance actually loaded, so the table never
// lists a phrase that does nothing here.
//
// Written with the help of Claude Code.
import { useMemo } from 'preact/compat';
import Modal from './Modal.jsx';
import { workingDictationCommands } from '../lib/dictationCommands.js';

export default function DictationCommandsModal({ t, rules, onClose }) {
  const commands = useMemo(() => workingDictationCommands(rules), [rules]);
  // Insert a section header row every time the group changes (the curated
  // list is already ordered by group).
  const rows = [];
  let group = null;
  commands.forEach((cmd, i) => {
    if (cmd.group !== group) {
      group = cmd.group;
      rows.push(
        <tr key={`g-${group}`} className="dict-commands__group">
          <th colSpan={2}>{t(group)}</th>
        </tr>
      );
    }
    rows.push(
      <tr key={i} data-testid="dict-command-row">
        <td className="dict-commands__target">
          {cmd.targetKey === 'dictCmdTemplate'
            ? <>{cmd.target} <span className="dict-commands__desc">({t(cmd.targetKey)})</span></>
            : <><code>{cmd.target}</code>{cmd.targetKey && <span className="dict-commands__desc"> {t(cmd.targetKey)}</span>}</>}
        </td>
        <td>
          {cmd.working.map((form, j) => (
            <span key={form}>
              {j > 0 && ', '}
              {form === cmd.recommended ? <strong data-testid="dict-command-recommended">{form}</strong> : form}
            </span>
          ))}
        </td>
      </tr>
    );
  });

  return (
    <Modal onClose={onClose} className="modal-panel--dict-commands">
      <h3 style={{ marginTop: 0 }}>{t('dictCommands')}</h3>
      <p className="dict-commands__intro">{t('dictCommandsIntro')}</p>
      <table className="dict-commands" data-testid="dict-commands-table">
        <thead>
          <tr>
            <th>{t('dictCmdColTarget')}</th>
            <th>{t('dictCmdColForms')}</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </Modal>
  );
}
