import { useMemo } from 'react';
import { useFederationStore } from '../../stores/federation-store';
import { validateFederation } from '../../lib/federation-validator';

export function FederationSettingsInspector() {
  const { name, version, enforcement, teams, bridges, setFederationMeta } = useFederationStore();

  const validation = useMemo(
    () => validateFederation(teams, bridges),
    [teams, bridges],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--color-text)',
      }}>
        Federation Settings
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Field label="Federation Name">
          <input
            style={inputStyle}
            value={name}
            onChange={e => setFederationMeta({ name: e.target.value })}
            data-testid="federation-name"
          />
        </Field>

        <Field label="Version">
          <input
            style={inputStyle}
            type="number"
            min="1"
            value={version}
            onChange={e => setFederationMeta({ version: parseInt(e.target.value, 10) || 1 })}
          />
        </Field>

        <Field label="Enforcement">
          <select
            style={inputStyle}
            value={enforcement}
            onChange={e => setFederationMeta({ enforcement: e.target.value as 'strict' | 'permissive' | 'audit' })}
          >
            <option value="permissive">permissive</option>
            <option value="audit">audit</option>
            <option value="strict">strict</option>
          </select>
        </Field>

        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', marginTop: '4px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Summary
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {teams.size} team{teams.size !== 1 ? 's' : ''} {'\u00B7'} {bridges.length} bridge{bridges.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Validation issues */}
        {(validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Validation
            </div>
            {validation.errors.map((issue, i) => (
              <div key={`err-${i}`} style={{ fontSize: '12px', color: 'var(--color-danger)', padding: '2px 0' }}>
                {issue.message}
              </div>
            ))}
            {validation.warnings.map((issue, i) => (
              <div key={`warn-${i}`} style={{ fontSize: '12px', color: 'var(--color-warning)', padding: '2px 0' }}>
                {issue.message}
              </div>
            ))}
          </div>
        )}

        <div style={{
          marginTop: '8px',
          padding: '8px',
          background: 'var(--color-bg)',
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--color-text-muted)',
        }}>
          Click a team node to view its details. Click a bridge edge to inspect the signal routing.
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
