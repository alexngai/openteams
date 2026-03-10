import { useFederationStore } from '../../stores/federation-store';

interface Props {
  bridgeId: string;
}

export function FederationBridgeInspector({ bridgeId }: Props) {
  const edges = useFederationStore(s => s.edges);
  const removeBridge = useFederationStore(s => s.removeBridge);

  const edge = edges.find(e => e.id === bridgeId);
  const data = edge?.data;
  if (!data) return <div style={{ padding: '12px', color: 'var(--color-text-muted)' }}>Bridge not found</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--color-text)',
      }}>
        Bridge
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Source */}
        <div>
          <div style={sectionLabel}>Source</div>
          <div style={detailBox}>
            <div style={detailRow}>
              <span style={detailLabel}>Team</span>
              <span style={detailValue}>{data.fromTeam}</span>
            </div>
            <div style={detailRow}>
              <span style={detailLabel}>Signal</span>
              <span style={{ ...tagStyle, color: '#22c55e' }}>{data.fromSignal}</span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div style={{ textAlign: 'center', fontSize: '20px', color: '#f59e0b' }}>
          {'\u2B07'}
        </div>

        {/* Destination */}
        <div>
          <div style={sectionLabel}>Destination</div>
          <div style={detailBox}>
            <div style={detailRow}>
              <span style={detailLabel}>Team</span>
              <span style={detailValue}>{data.toTeam}</span>
            </div>
            <div style={detailRow}>
              <span style={detailLabel}>Channel</span>
              <span style={detailValue}>{data.toChannel}</span>
            </div>
            <div style={detailRow}>
              <span style={detailLabel}>Signal</span>
              <span style={{ ...tagStyle, color: '#3b82f6' }}>{data.toSignal}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
          <button
            onClick={() => { if (confirm('Remove this bridge?')) removeBridge(bridgeId); }}
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
            Remove Bridge
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: '6px',
};

const detailBox: React.CSSProperties = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: '6px',
  padding: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const detailRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '13px',
};

const detailLabel: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontWeight: 500,
};

const detailValue: React.CSSProperties = {
  color: 'var(--color-text)',
  fontWeight: 600,
};

const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'var(--color-border)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
  fontWeight: 600,
};
