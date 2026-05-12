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
    <div data-testid="role-inspector" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div data-testid="role-inspector-header" style={{
        padding: '12px',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 600,
        fontSize: '14px',
        color: 'var(--color-text)',
      }}>
        Role: {data.roleName}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border)',
      }}>
        {(['identity', 'communication', 'capabilities', 'prompts'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            data-testid={`role-tab-${tab}`}
            style={{
              flex: 1,
              padding: '8px 4px',
              fontSize: '13px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
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
  role: { name: string; displayName: string; description: string; model?: string; extends?: string; placement?: import('openteams').PlacementConfig };
  data: RoleNodeData;
  nodeId: string;
  updateRole: (u: Record<string, unknown>) => void;
}) {
  const configStore = useConfigStore();
  const pushSnapshot = useHistoryStore(s => s.pushSnapshot);
  const placement = role.placement;

  const handlePositionChange = (pos: 'root' | 'companion' | 'spawned') => {
    pushSnapshot();
    if (pos === 'root') {
      configStore.setTopologyRoot(data.roleName);
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

  const handlePlacementChange = (field: string, value: string) => {
    pushSnapshot();
    const current = placement || {};
    let updated: import('openteams').PlacementConfig | undefined;
    if (field === 'zone') {
      updated = { ...current, zone: value || undefined };
    } else if (field === 'affinity') {
      const arr = value.split(',').map(s => s.trim()).filter(Boolean);
      updated = { ...current, affinity: arr.length > 0 ? arr : undefined };
    } else if (field === 'replicas') {
      const n = parseInt(value, 10);
      updated = { ...current, replicas: isNaN(n) ? undefined : n };
    }
    // Clean up empty placement
    if (updated && !updated.zone && !updated.affinity?.length && !updated.replicas && !updated.constraints) {
      updated = undefined;
    }
    useConfigStore.getState().setRolePlacement(data.roleName, updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Field label="Name">
        <input style={{ ...inputStyle, opacity: 0.6 }} value={data.roleName} readOnly data-testid="role-name" />
      </Field>
      <Field label="Display Name">
        <input
          style={inputStyle}
          value={role.displayName}
          onChange={e => updateRole({ displayName: e.target.value })}
          data-testid="role-display-name"
        />
      </Field>
      <Field label="Description">
        <textarea
          style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
          value={role.description}
          onChange={e => updateRole({ description: e.target.value })}
          data-testid="role-description"
        />
      </Field>
      <Field label="Model">
        <select
          style={inputStyle}
          value={data.model || ''}
          data-testid="role-model"
          onChange={e => {
            pushSnapshot();
            const model = e.target.value || undefined;
            useCanvasStore.getState().updateNodeData(nodeId, { model });
            useConfigStore.getState().setRoleModel(data.roleName, model);
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
          data-testid="role-position"
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

      {/* Placement hints (federation) */}
      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '4px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Placement
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Field label="Zone">
            <input
              style={inputStyle}
              value={placement?.zone || ''}
              placeholder="e.g., us-east, gpu-cluster"
              onChange={e => handlePlacementChange('zone', e.target.value)}
              data-testid="role-placement-zone"
            />
          </Field>
          <Field label="Affinity (comma-separated)">
            <input
              style={inputStyle}
              value={placement?.affinity?.join(', ') || ''}
              placeholder="e.g., high-memory, gpu"
              onChange={e => handlePlacementChange('affinity', e.target.value)}
              data-testid="role-placement-affinity"
            />
          </Field>
          <Field label="Replicas">
            <input
              style={inputStyle}
              type="number"
              min="1"
              value={placement?.replicas ?? ''}
              placeholder="1"
              onChange={e => handlePlacementChange('replicas', e.target.value)}
              data-testid="role-placement-replicas"
            />
          </Field>
        </div>
      </div>
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
          <div key={i} style={{ fontSize: '13px', padding: '4px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          <div key={i} style={{ fontSize: '13px', padding: '2px 0', color: 'var(--color-text-secondary)' }}>
            {'\u2192'} {r.to} via {r.via} {r.signals?.length ? `[${r.signals.join(', ')}]` : ''}
          </div>
        ))}
        <button
          onClick={() => {
            const allRoles = Array.from(useConfigStore.getState().roles.keys()).filter(r => r !== data.roleName);
            if (allRoles.length === 0) { alert('No other roles to route to.'); return; }
            const to = prompt(`Target role (${allRoles.join(', ')}):`);
            if (!to || !useConfigStore.getState().roles.has(to)) return;
            pushSnapshot();
            const route = { from: data.roleName, to, via: 'direct' as const, signals: [] };
            useConfigStore.getState().addPeerRoute(route);
            // Add peer route edge to canvas
            useCanvasStore.getState().addEdge({
              id: `peer-${data.roleName}-${to}-${Date.now()}`,
              source: `role-${data.roleName}`,
              target: `role-${to}`,
              type: 'peer-route',
              data: { kind: 'peer-route', signals: [], via: 'direct' },
            });
            // Update route counts on node
            const newOutCount = useConfigStore.getState().peerRoutes.filter(r2 => r2.from === data.roleName).length;
            useCanvasStore.getState().updateNodeData(`role-${data.roleName}`, { peerRoutesOut: newOutCount });
            const newInCount = useConfigStore.getState().peerRoutes.filter(r2 => r2.to === to).length;
            useCanvasStore.getState().updateNodeData(`role-${to}`, { peerRoutesIn: newInCount });
          }}
          style={{ ...addBtnStyle, marginTop: '4px' }}
        >
          + Add Route
        </button>
      </div>
      <div>
        <div style={sectionLabel}>Peer Routes (incoming)</div>
        {inRoutes.length === 0 && <div style={emptyStyle}>None</div>}
        {inRoutes.map((r, i) => (
          <div key={i} style={{ fontSize: '13px', padding: '2px 0', color: 'var(--color-text-secondary)' }}>
            {'\u2190'} {r.from} via {r.via} {r.signals?.length ? `[${r.signals.join(', ')}]` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function CapabilitiesTab({ role, data, updateRole }: {
  role: { capabilities: string[]; extends?: string; loadout?: string };
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

  // Loadout binding (slug shape). Dropdown is populated from the
  // team's embedded loadouts so the relationship is obvious \u2014 the
  // bound loadout shows up in the same sidebar list. (Standalone
  // openhive loadouts aren't fetched here; binding to those would
  // need a name-based reference that the bundling pipeline can
  // resolve via `resolveExternalLoadout`. v1 scope.)
  const embeddedLoadoutNames = Object.keys(configStore.loadouts);
  const handleBindLoadout = (next: string) => {
    updateRole({ loadout: next || undefined });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={sectionLabel}>Bound loadout</div>
        <select
          value={role.loadout ?? ''}
          onChange={e => handleBindLoadout(e.target.value)}
          data-testid="role-loadout-select"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-elevated)',
            color: 'var(--color-text)',
            boxSizing: 'border-box',
          }}
        >
          <option value="">\u2014 none \u2014</option>
          {embeddedLoadoutNames.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Applies the loadout's capabilities, permissions, mcp_servers,
          and prompt_addendum to this role at hydrate time.
          {embeddedLoadoutNames.length === 0 && (
            <> Add a loadout from the sidebar to enable binding.</>
          )}
        </p>
      </div>

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
          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '2px 0', cursor: 'pointer' }}>
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

/**
 * Standard prompt sections openteams's bundled templates use most
 * often. Quick-add buttons surface these so users don't have to retype
 * filenames. Anything not in the list can still be added via the
 * free-text input.
 */
const PRESET_SECTIONS = ['SOUL.md', 'RULES.md', 'RESPONSIBILITIES.md', 'EXAMPLES.md', 'CONSTRAINTS.md'];

/**
 * Rough token estimate: GPT-style tokenizers average ~4 chars/token
 * for English prose. Code/JSON skews lower (~3.5). We pick 4 as a
 * useful upper-bound estimate to surface "how big is this prompt
 * getting" without bundling a real tokenizer.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function PromptsTab({ role, updateRole }: {
  role: {
    promptContent?: string;
    additionalPrompts?: { name: string; content: string }[];
    loadout?: string;
  };
  updateRole: (u: Record<string, unknown>) => void;
}) {
  const loadouts = useConfigStore(s => s.loadouts);
  const [draftName, setDraftName] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const additional = role.additionalPrompts ?? [];
  const existingNames = new Set([role.promptContent ? 'ROLE.md' : null, ...additional.map(p => p.name)].filter(Boolean) as string[]);

  const addSection = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existingNames.has(trimmed)) return;
    updateRole({ additionalPrompts: [...additional, { name: trimmed, content: '' }] });
    setDraftName('');
  };

  const removeSection = (i: number) => {
    const next = additional.slice();
    next.splice(i, 1);
    updateRole({ additionalPrompts: next.length ? next : undefined });
  };

  // Loadout prompt_addendum: concatenation order at hydrate time is
  // role-primary → additional sections → loadout.prompt_addendum. Show
  // it in the preview so the user can see what the agent actually
  // gets, including the loadout-binding effect (S2.2).
  const boundLoadout = role.loadout ? loadouts[role.loadout] : undefined;
  const loadoutAddendum =
    typeof (boundLoadout as { prompt_addendum?: string } | undefined)?.prompt_addendum === 'string'
      ? ((boundLoadout as { prompt_addendum: string }).prompt_addendum)
      : '';

  const composedPrompt = (() => {
    const parts: string[] = [];
    if (role.promptContent) parts.push(role.promptContent);
    for (const p of additional) {
      if (p.content) parts.push(`## ${p.name}\n\n${p.content}`);
    }
    if (loadoutAddendum) parts.push(`<!-- loadout.${role.loadout} -->\n${loadoutAddendum}`);
    return parts.join('\n\n');
  })();
  const composedTokens = estimateTokens(composedPrompt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Field label={`Primary Prompt (ROLE.md)  •  ~${estimateTokens(role.promptContent ?? '')} tokens`}>
        <textarea
          style={{
            ...inputStyle,
            minHeight: '200px',
            fontFamily: 'monospace',
            fontSize: '13px',
            resize: 'vertical',
            lineHeight: '1.5',
          }}
          value={role.promptContent || ''}
          onChange={e => updateRole({ promptContent: e.target.value })}
          placeholder="# Role Name&#10;&#10;Write the role's prompt here..."
        />
      </Field>

      {additional.map((p, i) => (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              {p.name}  •  ~{estimateTokens(p.content)} tokens
            </label>
            <button
              onClick={() => removeSection(i)}
              data-testid={`prompt-section-remove-${p.name}`}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '2px 6px',
              }}
              title="Remove section"
            >
              {'×'}
            </button>
          </div>
          <textarea
            style={{
              ...inputStyle,
              minHeight: '120px',
              fontFamily: 'monospace',
              fontSize: '13px',
              resize: 'vertical',
              lineHeight: '1.5',
            }}
            value={p.content}
            onChange={e => {
              const prompts = [...additional];
              prompts[i] = { ...prompts[i], content: e.target.value };
              updateRole({ additionalPrompts: prompts });
            }}
          />
        </div>
      ))}

      {/* Section quick-add: preset chips + free-text input — replaces
          the old window.prompt() dialog with an inline UX that's
          discoverable and keyboard-friendly. */}
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
          Add prompt section
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {PRESET_SECTIONS.filter(name => !existingNames.has(name)).map(name => (
            <button
              key={name}
              onClick={() => addSection(name)}
              data-testid={`prompt-section-preset-${name}`}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                background: 'var(--color-elevated)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              + {name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Custom section filename (e.g. NOTES.md)"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addSection(draftName);
              }
            }}
            style={{ ...inputStyle, flex: 1, fontSize: 12 }}
          />
          <button onClick={() => addSection(draftName)} style={{ ...addBtnStyle, fontSize: 12, padding: '6px 10px' }}>
            +
          </button>
        </div>
      </div>

      {/* Composed-prompt preview — read-only view of what the agent
          actually receives, including the bound loadout's prompt
          addendum. Particularly useful for verifying the loadout-
          binding effect from S2.2. */}
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Composed prompt  •  ~{composedTokens} tokens
            {role.loadout && (
              <span style={{ marginLeft: 6, color: '#10b981' }}>+ loadout: {role.loadout}</span>
            )}
          </label>
          <button
            onClick={() => setShowPreview(v => !v)}
            data-testid="prompt-composed-toggle"
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            {showPreview ? 'Hide' : 'Show'}
          </button>
        </div>
        {showPreview && (
          <pre
            data-testid="prompt-composed-body"
            style={{
              ...inputStyle,
              minHeight: '120px',
              maxHeight: '320px',
              overflow: 'auto',
              fontFamily: 'monospace',
              fontSize: '12px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {composedPrompt || <em style={{ color: 'var(--color-text-muted)' }}>(empty)</em>}
          </pre>
        )}
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

const panelStyle: React.CSSProperties = { padding: '12px', color: 'var(--color-text-muted)' };
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '13px',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  boxSizing: 'border-box',
};
const sectionLabel: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '6px' };
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
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--color-text-muted)',
};
const emptyStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--color-text-muted)', fontStyle: 'italic' };
