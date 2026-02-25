import { useState, useMemo } from 'react';
import { compileToYaml } from '../../lib/compiler';
import type { CompiledFile } from '../../lib/compiler';

interface Props {
  onClose: () => void;
}

export function ExportModal({ onClose }: Props) {
  const files = useMemo(() => compileToYaml(), []);
  const [activeFile, setActiveFile] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAll = async () => {
    const combined = files.map(f => `# --- ${f.path} ---\n${f.content}`).join('\n\n');
    await navigator.clipboard.writeText(combined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={overlayStyle} onClick={onClose} data-testid="export-modal-overlay">
      <div style={modalStyle} onClick={e => e.stopPropagation()} data-testid="export-modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--ot-text)' }}>Export Template</h3>
          <button onClick={onClose} style={closeBtnStyle} data-testid="export-close">{'\u00D7'}</button>
        </div>

        {/* File tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          {files.map((f, i) => (
            <button
              key={f.path}
              onClick={() => setActiveFile(i)}
              data-testid={`export-tab-${f.path}`}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                border: '1px solid var(--ot-border)',
                borderRadius: '4px',
                background: i === activeFile ? 'var(--ot-accent)' : 'var(--ot-bg)',
                color: i === activeFile ? '#fff' : 'var(--ot-text-muted)',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              {f.path}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ position: 'relative' }}>
          <pre style={preStyle} data-testid="export-content">
            {files[activeFile]?.content || ''}
          </pre>
          <button
            onClick={() => handleCopy(files[activeFile]?.content || '')}
            style={{ ...copyBtnStyle, position: 'absolute', top: '8px', right: '8px' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          <button onClick={handleCopyAll} style={actionBtnStyle}>
            Copy All Files
          </button>
          <button onClick={onClose} style={{ ...actionBtnStyle, background: 'var(--ot-border)', color: 'var(--ot-text)' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'var(--ot-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};
const modalStyle: React.CSSProperties = {
  background: 'var(--ot-surface)', borderRadius: '12px', padding: '20px', width: '720px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
};
const closeBtnStyle: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--ot-text-muted)',
};
const preStyle: React.CSSProperties = {
  background: 'var(--ot-bg)', border: '1px solid var(--ot-border)', borderRadius: '8px', padding: '12px', fontSize: '11px', fontFamily: 'monospace', overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap', margin: 0, color: 'var(--ot-text)',
};
const copyBtnStyle: React.CSSProperties = {
  background: 'var(--ot-accent)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer',
};
const actionBtnStyle: React.CSSProperties = {
  background: 'var(--ot-accent)', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
};
