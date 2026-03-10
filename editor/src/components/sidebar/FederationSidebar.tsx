import { useFederationStore } from '../../stores/federation-store';
import type { FederationTeamEntry } from '../../stores/federation-store';

export function FederationSidebar() {
  const teams = useFederationStore(s => s.teams);
  const bridges = useFederationStore(s => s.bridges);
  const addTeam = useFederationStore(s => s.addTeam);
  const addBridge = useFederationStore(s => s.addBridge);
  const setSelection = useFederationStore(s => s.setSelection);

  const handleAddTeam = () => {
    let key = 'team-a';
    let i = 1;
    while (teams.has(key)) {
      key = `team-${String.fromCharCode(96 + (++i))}`;
      if (i > 26) key = `team-${i}`;
    }

    const name = prompt('Team key (used in federation.yaml):', key);
    if (!name) return;

    const templatePath = prompt('Template path (relative or absolute):', `./${name}`);
    if (!templatePath) return;

    const entry: FederationTeamEntry = {
      teamKey: name,
      teamName: name,
      description: '',
      templatePath,
      roleCount: 0,
      channelCount: 0,
      exportCount: 0,
      importCount: 0,
      exports: [],
      imports: [],
    };

    addTeam(entry);
    setSelection(`team-${name}`, null);
  };

  const handleAddBridge = () => {
    const teamKeys = Array.from(teams.keys());
    if (teamKeys.length < 2) {
      alert('Need at least 2 teams to create a bridge.');
      return;
    }

    // Find teams with exports
    const teamsWithExports = teamKeys.filter(k => {
      const t = teams.get(k);
      return t && t.exports.length > 0;
    });

    // Find teams with imports
    const teamsWithImports = teamKeys.filter(k => {
      const t = teams.get(k);
      return t && t.imports.length > 0;
    });

    const fromTeam = prompt(
      `Source team (${teamsWithExports.length > 0 ? `have exports: ${teamsWithExports.join(', ')}` : teamKeys.join(', ')}):`
    );
    if (!fromTeam || !teams.has(fromTeam)) { alert('Unknown team'); return; }

    const sourceExports = teams.get(fromTeam)!.exports;
    const fromSignal = prompt(
      sourceExports.length > 0
        ? `Signal to export (${sourceExports.map(e => e.signal).join(', ')}):`
        : 'Signal name (UPPER_CASE):'
    );
    if (!fromSignal) return;

    const toTeam = prompt(
      `Destination team (${teamsWithImports.length > 0 ? `have imports: ${teamsWithImports.join(', ')}` : teamKeys.filter(k => k !== fromTeam).join(', ')}):`
    );
    if (!toTeam || !teams.has(toTeam)) { alert('Unknown team'); return; }

    const destImports = teams.get(toTeam)!.imports;
    const toChannel = prompt(
      destImports.length > 0
        ? `Destination channel (${destImports.map(i => i.channel).join(', ')}):`
        : 'Channel name:'
    );
    if (!toChannel) return;

    const matchingImport = destImports.find(i => i.channel === toChannel);
    const toSignal = prompt(
      matchingImport
        ? `Destination signal (${matchingImport.signals.join(', ')}):`
        : 'Signal name (UPPER_CASE):'
    );
    if (!toSignal) return;

    addBridge({
      from: { team: fromTeam, signal: fromSignal },
      to: { team: toTeam, channel: toChannel, signal: toSignal },
    });
  };

  return (
    <div style={{
      width: '240px',
      background: 'var(--color-sidebar)',
      borderRight: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Actions */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Add
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleAddTeam} style={blockBtnStyle('#f59e0b')} data-testid="add-team">
            + Team
          </button>
          <button onClick={handleAddBridge} style={blockBtnStyle('#8b5cf6')} data-testid="add-bridge">
            + Bridge
          </button>
        </div>
      </div>

      {/* Team list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Teams ({teams.size})
        </div>
        {Array.from(teams.entries()).map(([key, entry]) => (
          <div
            key={key}
            onClick={() => setSelection(`team-${key}`, null)}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'var(--color-text)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--color-border)')}
            onMouseOut={e => (e.currentTarget.style.background = 'none')}
          >
            <span style={{ color: '#f59e0b', fontSize: '12px' }}>{'\u{1F4E6}'}</span>
            <span>{key}</span>
            {(entry.exportCount > 0 || entry.importCount > 0) && (
              <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                {entry.exportCount > 0 ? `${entry.exportCount}E` : ''}
                {entry.exportCount > 0 && entry.importCount > 0 ? '/' : ''}
                {entry.importCount > 0 ? `${entry.importCount}I` : ''}
              </span>
            )}
          </div>
        ))}

        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginTop: '16px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Bridges ({bridges.length})
        </div>
        {bridges.map((b, i) => (
          <div
            key={i}
            onClick={() => setSelection(null, `bridge-${i}`)}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              borderRadius: '4px',
            }}
            onMouseOver={e => (e.currentTarget.style.background = 'var(--color-border)')}
            onMouseOut={e => (e.currentTarget.style.background = 'none')}
          >
            {b.from.team}:{b.from.signal} {'\u2192'} {b.to.team}:{b.to.channel}
          </div>
        ))}
      </div>
    </div>
  );
}

function blockBtnStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    background: color,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '13px',
  };
}
