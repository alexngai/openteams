import { useConfigStore } from '../../stores/config-store';
import { useHistoryStore } from '../../stores/history-store';
import type { ExportDeclaration, ImportDeclaration } from '@openteams/template/types';
import * as yaml from 'js-yaml';

export function TeamInspector() {
  const team = useConfigStore(s => s.team);
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);
  const setTeam = useConfigStore(s => s.setTeam);
  const setExports = useConfigStore(s => s.setExports);
  const setImports = useConfigStore(s => s.setImports);
  const channels = useConfigStore(s => s.channels);

  const extensionsYaml = Object.keys(team.extensions).length > 0
    ? yaml.dump(team.extensions, { lineWidth: -1, noRefs: true })
    : '';

  const handleExtensionsChange = (value: string) => {
    try {
      const parsed = yaml.load(value) as Record<string, unknown>;
      if (typeof parsed === 'object' && parsed !== null) {
        pushSnapshot();
        setTeam({ extensions: parsed });
      }
    } catch {
      // Invalid YAML — ignore until valid
    }
  };

  const handleAddExport = () => {
    const signal = prompt('Signal name to export (UPPER_CASE):');
    if (!signal) return;
    pushSnapshot();
    setExports([...team.exports, { signal }]);
  };

  const handleRemoveExport = (index: number) => {
    pushSnapshot();
    setExports(team.exports.filter((_, i) => i !== index));
  };

  const handleUpdateExportDescription = (index: number, description: string) => {
    pushSnapshot();
    const updated = [...team.exports];
    updated[index] = { ...updated[index], description: description || undefined };
    setExports(updated);
  };

  const handleAddImport = () => {
    const channelNames = Object.keys(channels);
    const channel = prompt(
      channelNames.length > 0
        ? `Channel name to import into (${channelNames.join(', ')}):`
        : 'Channel name to import into:'
    );
    if (!channel) return;
    const signals = prompt('Signal names (comma-separated, UPPER_CASE):');
    if (!signals) return;
    pushSnapshot();
    setImports([...team.imports, {
      channel,
      signals: signals.split(',').map(s => s.trim()).filter(Boolean),
    }]);
  };

  const handleRemoveImport = (index: number) => {
    pushSnapshot();
    setImports(team.imports.filter((_, i) => i !== index));
  };

  return (
    <div data-testid="team-inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--color-text)',
      }}>
        Team Settings
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Field label="Team Name">
          <input
            style={inputStyle}
            value={team.name}
            onChange={e => { pushSnapshot(); setTeam({ name: e.target.value }); }}
            data-testid="team-name"
          />
        </Field>

        <Field label="Description">
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={team.description}
            onChange={e => { pushSnapshot(); setTeam({ description: e.target.value }); }}
            data-testid="team-description"
          />
        </Field>

        <Field label="Enforcement">
          <select
            style={inputStyle}
            value={team.enforcement}
            onChange={e => { pushSnapshot(); setTeam({ enforcement: e.target.value as 'strict' | 'permissive' | 'audit' }); }}
            data-testid="team-enforcement"
          >
            <option value="permissive">permissive</option>
            <option value="audit">audit</option>
            <option value="strict">strict</option>
          </select>
        </Field>

        <Field label="Version">
          <input style={{ ...inputStyle, opacity: 0.6 }} value="1" readOnly />
        </Field>

        {/* Federation: Exports */}
        <div>
          <div style={sectionLabel}>
            Exports
            <span style={sectionHint}>Signals available to other teams</span>
          </div>
          {team.exports.length === 0 && (
            <div style={emptyStyle}>No exports defined</div>
          )}
          {team.exports.map((exp, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
              <span style={tagStyle}>{exp.signal}</span>
              {exp.description && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {exp.description}
                </span>
              )}
              <button onClick={() => handleRemoveExport(i)} style={tagRemoveBtn}>{'\u00D7'}</button>
            </div>
          ))}
          <button onClick={handleAddExport} style={addBtnStyle} data-testid="add-export">+ Export</button>
        </div>

        {/* Federation: Imports */}
        <div>
          <div style={sectionLabel}>
            Imports
            <span style={sectionHint}>Channels receiving external signals</span>
          </div>
          {team.imports.length === 0 && (
            <div style={emptyStyle}>No imports defined</div>
          )}
          {team.imports.map((imp, i) => (
            <div key={i} style={{ marginBottom: '6px', padding: '4px 6px', background: 'var(--color-bg)', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{imp.channel}</span>
                <button onClick={() => handleRemoveImport(i)} style={tagRemoveBtn}>{'\u00D7'}</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '2px' }}>
                {imp.signals.map(sig => (
                  <span key={sig} style={tagStyle}>{sig}</span>
                ))}
              </div>
            </div>
          ))}
          <button onClick={handleAddImport} style={addBtnStyle} data-testid="add-import">+ Import</button>
        </div>

        {extensionsYaml && (
          <Field label="Extension Metadata (YAML)">
            <textarea
              style={{
                ...inputStyle,
                minHeight: '150px',
                fontFamily: 'monospace',
                fontSize: '13px',
                resize: 'vertical',
                lineHeight: '1.5',
              }}
              defaultValue={extensionsYaml}
              onBlur={e => handleExtensionsChange(e.target.value)}
            />
          </Field>
        )}

        <div style={{
          marginTop: '8px',
          padding: '8px',
          background: 'var(--color-bg)',
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--color-text-muted)',
        }}>
          Select a role or channel on the canvas to edit its properties. Click the canvas background to return here.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '4px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  boxSizing: 'border-box' as const,
};

const sectionLabel: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: '6px',
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
};

const sectionHint: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 400,
  color: 'var(--color-text-muted)',
  opacity: 0.7,
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  background: 'var(--color-border)',
  color: 'var(--color-text-secondary)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
};

const tagRemoveBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-muted)',
  padding: '0 2px',
  fontSize: '13px',
};

const addBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--color-border)',
  borderRadius: '4px',
  padding: '4px 8px',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--color-text-muted)',
  marginTop: '4px',
};

const emptyStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
  marginBottom: '4px',
};
