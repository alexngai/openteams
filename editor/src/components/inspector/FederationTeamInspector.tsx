import { useFederationStore } from '../../stores/federation-store';

interface Props {
  teamKey: string;
}

export function FederationTeamInspector({ teamKey }: Props) {
  const teams = useFederationStore(s => s.teams);
  const bridges = useFederationStore(s => s.bridges);
  const removeTeam = useFederationStore(s => s.removeTeam);
  const updateTeam = useFederationStore(s => s.updateTeam);

  const team = teams.get(teamKey);
  if (!team) return <div style={{ padding: '12px', color: 'var(--color-text-muted)' }}>Team not found</div>;

  const outBridges = bridges.filter(b => b.from.team === teamKey);
  const inBridges = bridges.filter(b => b.to.team === teamKey);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--color-text)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{ fontSize: '16px' }}>{'\u{1F4E6}'}</span>
        Team: {teamKey}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Field label="Team Key">
          <input style={{ ...inputStyle, opacity: 0.6 }} value={teamKey} readOnly />
        </Field>

        <Field label="Template Name">
          <input style={{ ...inputStyle, opacity: 0.6 }} value={team.teamName} readOnly />
        </Field>

        <Field label="Template Path">
          <input
            style={inputStyle}
            value={team.templatePath}
            onChange={e => updateTeam(teamKey, { templatePath: e.target.value })}
          />
        </Field>

        {team.description && (
          <Field label="Description">
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>{team.description}</div>
          </Field>
        )}

        {/* Stats */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
          <div style={sectionLabel}>Composition</div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', gap: '12px' }}>
            <span>{team.roleCount} roles</span>
            <span>{team.channelCount} channels</span>
          </div>
        </div>

        {/* Exports */}
        <div>
          <div style={sectionLabel}>Exports ({team.exports.length})</div>
          {team.exports.length === 0 && <div style={emptyStyle}>No exports</div>}
          {team.exports.map((exp, i) => (
            <div key={i} style={{ marginBottom: '2px' }}>
              <span style={tagStyle}>{exp.signal}</span>
              {exp.description && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginLeft: '4px' }}>
                  {exp.description}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Imports */}
        <div>
          <div style={sectionLabel}>Imports ({team.imports.length})</div>
          {team.imports.length === 0 && <div style={emptyStyle}>No imports</div>}
          {team.imports.map((imp, i) => (
            <div key={i} style={{ marginBottom: '4px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{imp.channel}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '1px' }}>
                {imp.signals.map(sig => (
                  <span key={sig} style={tagStyle}>{sig}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bridges */}
        {outBridges.length > 0 && (
          <div>
            <div style={sectionLabel}>Outgoing Bridges</div>
            {outBridges.map((b, i) => (
              <div key={i} style={{ fontSize: '12px', padding: '2px 0', color: 'var(--color-text-secondary)' }}>
                {b.from.signal} {'\u2192'} {b.to.team}:{b.to.channel}/{b.to.signal}
              </div>
            ))}
          </div>
        )}

        {inBridges.length > 0 && (
          <div>
            <div style={sectionLabel}>Incoming Bridges</div>
            {inBridges.map((b, i) => (
              <div key={i} style={{ fontSize: '12px', padding: '2px 0', color: 'var(--color-text-secondary)' }}>
                {b.from.team}:{b.from.signal} {'\u2192'} {b.to.channel}/{b.to.signal}
              </div>
            ))}
          </div>
        )}

        {/* Placement */}
        {team.placement && (
          <div>
            <div style={sectionLabel}>Placement</div>
            {team.placement.zone && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Zone: {team.placement.zone}</div>
            )}
            {team.placement.affinity && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Affinity: {team.placement.affinity.join(', ')}</div>
            )}
            {team.placement.replicas && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Replicas: {team.placement.replicas}</div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', marginTop: '4px' }}>
          <button
            onClick={() => { if (confirm(`Remove team "${teamKey}" from federation?`)) removeTeam(teamKey); }}
            style={{
              background: 'var(--color-danger)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Remove Team
          </button>
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
  marginBottom: '4px',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'var(--color-border)',
  color: 'var(--color-text-secondary)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
};

const emptyStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
};
