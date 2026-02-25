import { useConfigStore } from '../../stores/config-store';
import { useHistoryStore } from '../../stores/history-store';
import * as yaml from 'js-yaml';

export function TeamInspector() {
  const team = useConfigStore(s => s.team);
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);
  const setTeam = useConfigStore(s => s.setTeam);

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

  return (
    <div data-testid="team-inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--ot-border)',
        fontWeight: 600,
        fontSize: '13px',
        color: 'var(--ot-text)',
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

        {extensionsYaml && (
          <Field label="Extension Metadata (YAML)">
            <textarea
              style={{
                ...inputStyle,
                minHeight: '150px',
                fontFamily: 'monospace',
                fontSize: '11px',
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
          background: 'var(--ot-bg)',
          borderRadius: '6px',
          fontSize: '11px',
          color: 'var(--ot-text-muted)',
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
      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', display: 'block', marginBottom: '4px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '12px',
  border: '1px solid var(--ot-border)',
  borderRadius: '4px',
  background: 'var(--ot-bg)',
  color: 'var(--ot-text)',
  boxSizing: 'border-box' as const,
};
