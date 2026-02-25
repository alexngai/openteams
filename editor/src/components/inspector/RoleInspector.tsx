import { useState, useCallback } from 'react';
import { useConfigStore } from '../../stores/config-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useHistoryStore } from '../../stores/history-store';
import type { RoleNodeData, SubscriptionSummary } from '../../types/editor';
import { rebuildDerivedEdges } from '../../lib/rebuild-edges';

interface Props {
  nodeId: string;
  data: RoleNodeData;
}

type Tab = 'identity' | 'communication' | 'capabilities' | 'prompts';

export function RoleInspector({ nodeId, data }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('identity');
  const configStore = useConfigStore();
  const role = configStore.roles.get(data.roleName);
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);

  const updateRole = useCallback((updates: Record<string, unknown>) => {
    if (!role) return;
    pushSnapshot();
    const updated = { ...role, ...updates };
    useConfigStore.getState().setRole(data.roleName, updated);
    // Update node data to match
    useCanvasStore.getState().updateNodeData(nodeId, {
      ...updates,
      displayName: updates.displayName ?? data.displayName,
      description: updates.description ?? data.description,
      capabilities: updates.capabilities ?? data.capabilities,
    });
  }, [role, data, nodeId, pushSnapshot]);

  if (!role) return <div style={panelStyle}>Role not found</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--ot-border)',
        fontWeight: 600,
        fontSize: '13px',
        color: 'var(--ot-text)',
      }}>
        Role: {data.roleName}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--ot-border)',
      }}>
        {(['identity', 'communication', 'capabilities', 'prompts'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px 4px',
              fontSize: '11px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--ot-accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--ot-text)' : 'var(--ot-text-muted)',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 600 : 400,
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {activeTab === 'identity' && (
          <IdentityTab role={role} data={data} nodeId={nodeId} updateRole={updateRole} />
        )}
        {activeTab === 'communication' && (
          <CommunicationTab data={data} />
        )}
        {activeTab === 'capabilities' && (
          <CapabilitiesTab role={role} data={data} updateRole={updateRole} />
        )}
        {activeTab === 'prompts' && (
          <PromptsTab role={role} updateRole={updateRole} />
        )}
      </div>
    </div>
  );
}

function IdentityTab({ role, data, nodeId, updateRole }: {
  role: { name: string; displayName: string; description: string; model?: string; extends?: string };
  data: RoleNodeData;
  nodeId: string;
  updateRole: (u: Record<string, unknown>) => void;
}) {
  const configStore = useConfigStore();
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);

  const handlePositionChange = (pos: 'root' | 'companion' | 'spawned') => {
    pushSnapshot();
    if (pos === 'root') {
      configStore.setTopologyRoot(data.roleName);
      // Remove from companions if it was there
      configStore.setTopologyCompanions(
        configStore.topologyCompanions.filter(c => c !== data.roleName)
      );
    } else if (pos === 'companion') {
      if (configStore.topologyRoot === data.roleName) {
        configStore.setTopologyRoot('');
      }
      if (!configStore.topologyCompanions.includes(data.roleName)) {
        configStore.setTopologyCompanions([...configStore.topologyCompanions, data.roleName]);
      }
    } else {
      if (configStore.topologyRoot === data.roleName) {
        configStore.setTopologyRoot('');
      }
      configStore.setTopologyCompanions(
        configStore.topologyCompanions.filter(c => c !== data.roleName)
      );
    }
    useCanvasStore.getState().updateNodeData(nodeId, { topologyPosition: pos });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Field label="Display Name">
        <input
          style={inputStyle}
          value={role.displayName}
          onChange={e => updateRole({ displayName: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <textarea
          style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
          value={role.description}
          onChange={e => updateRole({ description: e.target.value })}
        />
      </Field>
      <Field label="Model">
        <select
          style={inputStyle}
          value={data.model || ''}
          onChange={e => {
            pushSnapshot();
            useCanvasStore.getState().updateNodeData(nodeId, {
              model: e.target.value || undefined,
            });
          }}
        >
          <option value="">— default —</option>
          <option value="sonnet">sonnet</option>
          <option value="opus">opus</option>
          <option value="haiku">haiku</option>
        </select>
      </Field>
      <Field label="Position">
        <select
          style={inputStyle}
          value={data.topologyPosition}
          onChange={e => handlePositionChange(e.target.value as 'root' | 'companion' | 'spawned')}
        >
          <option value="root">Root</option>
          <option value="companion">Companion</option>
          <option value="spawned">Spawned</option>
        </select>
      </Field>
      <Field label="Extends">
        <select
          style={inputStyle}
          value={role.extends || ''}
          onChange={e => updateRole({ extends: e.target.value || undefined })}
        >
          <option value="">— none —</option>
          {Array.from(useConfigStore.getState().roles.keys())
            .filter(n => n !== data.roleName)
            .map(n => <option key={n} value={n}>{n}</option>)
          }
        </select>
      </Field>
    </div>
  );
}

function CommunicationTab({ data }: { data: RoleNodeData }) {
  const configStore = useConfigStore();
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);
  const emissions = configStore.emissions[data.roleName] || [];
  const subscriptions = configStore.subscriptions[data.roleName] || [];
  const peerRoutes = configStore.peerRoutes;
  const channels = configStore.channels;

  const outRoutes = peerRoutes.filter(r => r.from === data.roleName);
  const inRoutes = peerRoutes.filter(r => r.to === data.roleName);

  const handleRemoveEmission = (signal: string) => {
    pushSnapshot();
    const updated = emissions.filter(s => s !== signal);
    useConfigStore.getState().setEmissions(data.roleName, updated);
    rebuildDerivedEdges();
    useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { emits: updated });
  };

  const handleAddEmission = () => {
    const signal = prompt('Signal name (UPPER_CASE):');
    if (!signal) return;
    pushSnapshot();
    const updated = [...emissions, signal];
    useConfigStore.getState().setEmissions(data.roleName, updated);
    rebuildDerivedEdges();
    useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { emits: updated });
  };

  const handleRemoveSubscription = (index: number) => {
    pushSnapshot();
    const updated = subscriptions.filter((_, i) => i !== index);
    useConfigStore.getState().setSubscriptions(data.roleName, updated);
    rebuildDerivedEdges();
    const subs = updated.map(s => ({ channel: s.channel, signals: s.signals || ('all' as const) }));
    useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { subscribesTo: subs });
  };

  const handleAddSubscription = () => {
    const channelNames = Object.keys(channels);
    if (channelNames.length === 0) {
      alert('No channels defined. Create a channel first.');
      return;
    }
    const channel = prompt(`Channel name (${channelNames.join(', ')}):`);
    if (!channel || !channels[channel]) return;
    pushSnapshot();
    const updated = [...subscriptions, { channel }];
    useConfigStore.getState().setSubscriptions(data.roleName, updated);
    rebuildDerivedEdges();
    const subs = updated.map(s => ({ channel: s.channel, signals: s.signals || ('all' as const) }));
    useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { subscribesTo: subs });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Emissions */}
      <div>
        <div style={sectionLabel}>Emits</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {emissions.map(sig => (
            <span key={sig} style={tagStyle}>
              {sig}
              <button onClick={() => handleRemoveEmission(sig)} style={tagRemoveBtn}>{'\u00D7'}</button>
            </span>
          ))}
          <button onClick={handleAddEmission} style={addBtnStyle}>+</button>
        </div>
      </div>

      {/* Subscriptions */}
      <div>
        <div style={sectionLabel}>Subscribes to</div>
        {subscriptions.map((sub, i) => (
          <div key={i} style={{ fontSize: '11px', padding: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              <strong>{sub.channel}</strong>
              {sub.signals ? ` (${sub.signals.join(', ')})` : ' (all)'}
            </span>
            <button onClick={() => handleRemoveSubscription(i)} style={tagRemoveBtn}>{'\u00D7'}</button>
          </div>
        ))}
        <button onClick={handleAddSubscription} style={{ ...addBtnStyle, marginTop: '4px' }}>+ Subscription</button>
      </div>

      {/* Peer Routes */}
      <div>
        <div style={sectionLabel}>Peer Routes (outgoing)</div>
        {outRoutes.length === 0 && <div style={emptyStyle}>None</div>}
        {outRoutes.map((r, i) => (
          <div key={i} style={{ fontSize: '11px', padding: '2px 0', color: 'var(--ot-text-secondary)' }}>
            {'\u2192'} {r.to} via {r.via} {r.signals?.length ? `[${r.signals.join(', ')}]` : ''}
          </div>
        ))}
      </div>
      <div>
        <div style={sectionLabel}>Peer Routes (incoming)</div>
        {inRoutes.length === 0 && <div style={emptyStyle}>None</div>}
        {inRoutes.map((r, i) => (
          <div key={i} style={{ fontSize: '11px', padding: '2px 0', color: 'var(--ot-text-secondary)' }}>
            {'\u2190'} {r.from} via {r.via} {r.signals?.length ? `[${r.signals.join(', ')}]` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilitiesTab({ role, data, updateRole }: {
  role: { capabilities: string[]; extends?: string };
  data: RoleNodeData;
  updateRole: (u: Record<string, unknown>) => void;
}) {
  const configStore = useConfigStore();
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);

  const handleRemoveCap = (cap: string) => {
    updateRole({ capabilities: role.capabilities.filter(c => c !== cap) });
  };

  const handleAddCap = () => {
    const cap = prompt('Capability name:');
    if (!cap) return;
    updateRole({ capabilities: [...role.capabilities, cap] });
  };

  const allRoles = Array.from(configStore.roles.keys());
  const spawnRules = configStore.spawnRules[data.roleName] || [];

  const handleToggleSpawn = (target: string) => {
    pushSnapshot();
    const current = configStore.spawnRules[data.roleName] || [];
    const updated = current.includes(target)
      ? current.filter(r => r !== target)
      : [...current, target];
    configStore.setSpawnRules(data.roleName, updated);
    useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { canSpawn: updated });
    rebuildDerivedEdges();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={sectionLabel}>Capabilities</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {role.capabilities.map(cap => (
            <span key={cap} style={tagStyle}>
              {cap}
              <button onClick={() => handleRemoveCap(cap)} style={tagRemoveBtn}>{'\u00D7'}</button>
            </span>
          ))}
          <button onClick={handleAddCap} style={addBtnStyle}>+</button>
        </div>
      </div>

      <div>
        <div style={sectionLabel}>Spawn Rules (can spawn)</div>
        {allRoles.filter(r => r !== data.roleName).map(r => (
          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={spawnRules.includes(r)}
              onChange={() => handleToggleSpawn(r)}
            />
            {r}
          </label>
        ))}
      </div>
    </div>
  );
}

function PromptsTab({ role, updateRole }: {
  role: { promptContent?: string; additionalPrompts?: { name: string; content: string }[] };
  updateRole: (u: Record<string, unknown>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Field label="Primary Prompt (ROLE.md)">
        <textarea
          style={{
            ...inputStyle,
            minHeight: '200px',
            fontFamily: 'monospace',
            fontSize: '11px',
            resize: 'vertical',
            lineHeight: '1.5',
          }}
          value={role.promptContent || ''}
          onChange={e => updateRole({ promptContent: e.target.value })}
          placeholder="# Role Name&#10;&#10;Write the role's prompt here..."
        />
      </Field>

      {role.additionalPrompts?.map((p, i) => (
        <Field key={i} label={p.name}>
          <textarea
            style={{
              ...inputStyle,
              minHeight: '120px',
              fontFamily: 'monospace',
              fontSize: '11px',
              resize: 'vertical',
              lineHeight: '1.5',
            }}
            value={p.content}
            onChange={e => {
              const prompts = [...(role.additionalPrompts || [])];
              prompts[i] = { ...prompts[i], content: e.target.value };
              updateRole({ additionalPrompts: prompts });
            }}
          />
        </Field>
      ))}

      <button
        onClick={() => {
          const name = prompt('Section name (e.g., SOUL.md):');
          if (!name) return;
          const prompts = [...(role.additionalPrompts || []), { name, content: '' }];
          updateRole({ additionalPrompts: prompts });
        }}
        style={{ ...addBtnStyle, padding: '6px', fontSize: '12px' }}
      >
        + Add Prompt Section
      </button>
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

const panelStyle: React.CSSProperties = { padding: '12px', color: 'var(--ot-text-muted)' };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '12px',
  border: '1px solid var(--ot-border)',
  borderRadius: '4px',
  background: 'var(--ot-bg)',
  color: 'var(--ot-text)',
  boxSizing: 'border-box',
};
const sectionLabel: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', marginBottom: '6px' };
const tagStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  background: 'var(--ot-border)',
  color: 'var(--ot-text-secondary)',
  padding: '2px 6px',
  borderRadius: '4px',
  fontSize: '10px',
  fontFamily: 'monospace',
};
const tagRemoveBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ot-text-muted)',
  padding: '0 2px',
  fontSize: '12px',
};
const addBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px dashed var(--ot-border)',
  borderRadius: '4px',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: '11px',
  color: 'var(--ot-text-muted)',
};
const emptyStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--ot-text-muted)', fontStyle: 'italic' };
