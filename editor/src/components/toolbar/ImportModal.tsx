import { useState } from 'react';
import * as yaml from 'js-yaml';
import type { TeamManifest, RoleDefinition } from '@openteams/template/types';
import { BUNDLED_TEMPLATES } from '../../lib/bundled-templates';
import { loadTemplate } from '../../lib/load-template';

interface Props {
  onClose: () => void;
}

export function ImportModal({ onClose }: Props) {
  const [mode, setMode] = useState<'paste' | 'template'>('template');
  const [teamYaml, setTeamYaml] = useState('');
  const [rolesYaml, setRolesYaml] = useState('');
  const [error, setError] = useState('');

  const handleImportPaste = () => {
    try {
      const manifest = yaml.load(teamYaml) as TeamManifest;
      if (!manifest?.name || !manifest?.roles || !manifest?.topology) {
        setError('Invalid team.yaml: missing required fields (name, roles, topology)');
        return;
      }

      const roleMap = new Map<string, RoleDefinition>();
      if (rolesYaml.trim()) {
        // Parse multiple role YAMLs separated by ---
        const docs = rolesYaml.split(/^---$/m).filter(d => d.trim());
        for (const doc of docs) {
          const role = yaml.load(doc) as RoleDefinition;
          if (role?.name) {
            roleMap.set(role.name, role);
          }
        }
      }

      loadTemplate(manifest, roleMap);
      onClose();
    } catch (e) {
      setError(`Parse error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleLoadTemplate = (key: string) => {
    const template = BUNDLED_TEMPLATES[key];
    if (template) {
      loadTemplate(template.manifest, template.roles);
      onClose();
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--ot-text)' }}>Import Template</h3>
          <button onClick={onClose} style={closeBtnStyle}>{'\u00D7'}</button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => setMode('template')}
            style={{ ...tabBtnStyle, borderColor: mode === 'template' ? 'var(--ot-accent)' : 'var(--ot-border)' }}
          >
            Load Template
          </button>
          <button
            onClick={() => setMode('paste')}
            style={{ ...tabBtnStyle, borderColor: mode === 'paste' ? 'var(--ot-accent)' : 'var(--ot-border)' }}
          >
            Paste YAML
          </button>
        </div>

        {mode === 'template' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(BUNDLED_TEMPLATES).map(([key, tmpl]) => (
              <button
                key={key}
                onClick={() => handleLoadTemplate(key)}
                style={templateBtnStyle}
              >
                <div style={{ fontWeight: 600, color: 'var(--ot-text)' }}>{key}</div>
                <div style={{ fontSize: '11px', color: 'var(--ot-text-muted)', marginTop: '2px' }}>
                  {tmpl.manifest.roles.length} roles {'\u00B7'} {Object.keys(tmpl.manifest.communication?.channels || {}).length} channels
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ot-text-muted)', marginTop: '2px' }}>
                  {tmpl.manifest.description}
                </div>
              </button>
            ))}
          </div>
        )}

        {mode === 'paste' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={labelStyle}>team.yaml</label>
              <textarea
                style={textareaStyle}
                value={teamYaml}
                onChange={e => { setTeamYaml(e.target.value); setError(''); }}
                placeholder="Paste your team.yaml content here..."
              />
            </div>
            <div>
              <label style={labelStyle}>roles/*.yaml (optional, separate with ---)</label>
              <textarea
                style={{ ...textareaStyle, minHeight: '120px' }}
                value={rolesYaml}
                onChange={e => { setRolesYaml(e.target.value); setError(''); }}
                placeholder="Paste role YAMLs separated by ---"
              />
            </div>
            {error && <div style={{ color: 'var(--ot-error)', fontSize: '12px' }}>{error}</div>}
            <button onClick={handleImportPaste} style={actionBtnStyle}>Import</button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'var(--ot-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--ot-surface)', borderRadius: '12px', padding: '20px', width: '600px', maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};
const closeBtnStyle: React.CSSProperties = { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ot-text-muted)' };
const tabBtnStyle: React.CSSProperties = { flex: 1, padding: '8px', fontSize: '12px', background: 'var(--ot-bg)', border: '2px solid', borderRadius: '6px', cursor: 'pointer', color: 'var(--ot-text)' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--ot-text-muted)', display: 'block', marginBottom: '4px' };
const textareaStyle: React.CSSProperties = { width: '100%', minHeight: '180px', padding: '8px', fontSize: '11px', fontFamily: 'monospace', border: '1px solid var(--ot-border)', borderRadius: '6px', background: 'var(--ot-bg)', color: 'var(--ot-text)', resize: 'vertical', boxSizing: 'border-box' as const };
const templateBtnStyle: React.CSSProperties = { textAlign: 'left' as const, padding: '12px', background: 'var(--ot-bg)', border: '1px solid var(--ot-border)', borderRadius: '8px', cursor: 'pointer' };
const actionBtnStyle: React.CSSProperties = { background: 'var(--ot-accent)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px', fontSize: '13px', cursor: 'pointer', fontWeight: 600 };
