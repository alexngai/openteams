import { useState } from 'react';
import type { LoadoutDefinition } from 'openteams';
import { useConfigStore } from '../../stores/config-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { useHistoryStore } from '../../stores/history-store';

/**
 * Embedded-loadout inspector. Renders when `useCanvasStore.selectedLoadout`
 * is set (via the sidebar's Loadouts list).
 *
 * v1 surface covers the fields most consumers actually wire:
 *   - identity (name, description, `extends`)
 *   - capabilities (flat string list — `capabilities_add` /
 *     `capabilities_remove` are out of scope until we have a UX for the
 *     three-axis merge)
 *   - permissions.allow / deny / ask (chip lists)
 *   - mcp_servers (chip list of refs/strings; structured entries
 *     round-trip via direct YAML import — out of scope for the visual
 *     form)
 *   - prompt_addendum (textarea)
 *
 * Anything not exposed here (skills, mcp_servers structured entries,
 * etc.) survives because the store carries the loadout as a verbatim
 * LoadoutDefinition; `compileToContent()` writes whatever's there.
 */
export function LoadoutInspector({ name }: { name: string }) {
  const def = useConfigStore((s) => s.loadouts[name]) as LoadoutDefinition | undefined;
  const allLoadouts = useConfigStore((s) => s.loadouts);
  const setLoadout = useConfigStore((s) => s.setLoadout);
  const removeLoadout = useConfigStore((s) => s.removeLoadout);
  const renameLoadout = useConfigStore((s) => s.renameLoadout);
  const setSelectedLoadout = useCanvasStore((s) => s.setSelectedLoadout);
  const pushSnapshot = useHistoryStore((s) => s.pushSnapshot);

  if (!def) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Loadout "{name}" not found.
        </p>
      </div>
    );
  }

  const update = (patch: Partial<LoadoutDefinition>) => {
    pushSnapshot();
    setLoadout(name, { ...def, ...patch });
  };

  const capabilities: string[] = Array.isArray(def.capabilities)
    ? (def.capabilities as string[])
    : [];

  const permissions = (def.permissions ?? {}) as {
    allow?: string[];
    deny?: string[];
    ask?: string[];
  };

  const mcpServers: string[] = Array.isArray(def.mcp_servers)
    ? (def.mcp_servers as unknown[]).map((m) =>
        typeof m === 'string' ? m : JSON.stringify(m),
      )
    : [];

  const writePermissions = (
    field: 'allow' | 'deny' | 'ask',
    next: string[],
  ) => {
    const updated = { ...permissions, [field]: next.length ? next : undefined };
    // Strip falsy keys so we don't pollute the YAML with empty entries
    const cleaned: typeof permissions = {};
    for (const k of ['allow', 'deny', 'ask'] as const) {
      if (updated[k] && updated[k]!.length > 0) cleaned[k] = updated[k];
    }
    update({
      permissions: Object.keys(cleaned).length > 0 ? cleaned : undefined,
    });
  };

  const handleRename = (next: string) => {
    if (!next || next === name) return;
    if (allLoadouts[next]) return; // collision
    pushSnapshot();
    renameLoadout(name, next);
    setSelectedLoadout(next);
  };

  const handleDelete = () => {
    if (!confirm(`Delete loadout "${name}"?`)) return;
    pushSnapshot();
    removeLoadout(name);
    setSelectedLoadout(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: '#10b981', fontSize: 13 }}>{'◆'}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>
          Loadout
        </span>
        <button onClick={handleDelete} style={iconBtnStyle} title="Delete loadout">
          {'✕'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <Field label="Name">
          <RenameInput value={name} onCommit={handleRename} />
          <p style={fieldHintStyle}>
            Slug used in role bindings (`role.loadout: {name}`).
          </p>
        </Field>

        <Field label="Description">
          <textarea
            rows={2}
            value={(def.description as string | undefined) ?? ''}
            onChange={(e) => update({ description: e.target.value || undefined })}
            style={textareaStyle}
          />
        </Field>

        <Field label="Extends (parent loadout)">
          <select
            value={def.extends ?? ''}
            onChange={(e) => update({ extends: e.target.value || undefined })}
            style={selectStyle}
          >
            <option value="">— none —</option>
            {Object.keys(allLoadouts)
              .filter((n) => n !== name)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
          <p style={fieldHintStyle}>
            Inherits capabilities, permissions, mcp_servers, prompt_addendum.
            Per-field merge: union for capabilities/allow/mcp; deny-wins; concatenate prompt_addendum.
          </p>
        </Field>

        <Field label="Capabilities">
          <ChipList
            values={capabilities}
            onChange={(next) =>
              update({ capabilities: next.length ? next : undefined })
            }
            placeholder="e.g. file.read"
          />
        </Field>

        <Field label="Permissions — Allow">
          <ChipList
            values={permissions.allow ?? []}
            onChange={(next) => writePermissions('allow', next)}
            placeholder="e.g. Read(*)"
          />
        </Field>
        <Field label="Permissions — Deny (wins on conflict)">
          <ChipList
            values={permissions.deny ?? []}
            onChange={(next) => writePermissions('deny', next)}
            placeholder="e.g. Bash(rm:*)"
          />
        </Field>
        <Field label="Permissions — Ask">
          <ChipList
            values={permissions.ask ?? []}
            onChange={(next) => writePermissions('ask', next)}
            placeholder="e.g. WebFetch(*)"
          />
        </Field>

        <Field label="MCP servers (refs or names)">
          <ChipList
            values={mcpServers}
            onChange={(next) =>
              update({
                mcp_servers: next.length
                  ? next.map((s) => {
                      if (s.trim().startsWith('{')) {
                        try {
                          return JSON.parse(s);
                        } catch {
                          return s;
                        }
                      }
                      return s;
                    })
                  : undefined,
              })
            }
            placeholder="@org/server-name"
          />
        </Field>

        <Field label="Prompt addendum">
          <textarea
            rows={6}
            value={(def.prompt_addendum as string | undefined) ?? ''}
            onChange={(e) => update({ prompt_addendum: e.target.value || undefined })}
            style={{ ...textareaStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
          />
          <p style={fieldHintStyle}>
            Appended to the bound role's system prompt at hydrate time.
          </p>
        </Field>
      </div>
    </div>
  );
}

// ── small presentational helpers ──────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function RenameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Sync when the prop changes (e.g. select-different-loadout)
  if (draft !== value && draft === '') setDraft(value);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      style={inputStyle}
    />
  );
}

function ChipList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {values.map((v) => (
          <span
            key={v}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              background: 'var(--color-elevated)',
              borderRadius: 4,
            }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 10,
              }}
              aria-label={`Remove ${v}`}
            >
              {'✕'}
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" onClick={commit} style={addBtnStyle}>
          +
        </button>
      </div>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  background: 'var(--color-elevated)',
  color: 'var(--color-text)',
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const addBtnStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  background: 'var(--color-elevated)',
  color: 'var(--color-text)',
  cursor: 'pointer',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontSize: 13,
  padding: 4,
};

const fieldHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginTop: 4,
};
