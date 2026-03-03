/**
 * E2E: Component rendering tests
 * Tests that key components render correctly and respond
 * to user interactions via React Testing Library.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useCanvasStore } from '../src/stores/canvas-store';
import { useConfigStore } from '../src/stores/config-store';
import { useHistoryStore } from '../src/stores/history-store';
import { useUIStore } from '../src/stores/ui-store';
import { useValidationStore } from '../src/stores/validation-store';
import { BUNDLED_TEMPLATES } from '../src/lib/bundled-templates';
import { loadTemplate } from '../src/lib/load-template';
import { Toolbar } from '../src/components/toolbar/Toolbar';
import { Sidebar } from '../src/components/sidebar/Sidebar';
import { Inspector } from '../src/components/inspector/Inspector';
import { TeamInspector } from '../src/components/inspector/TeamInspector';
import type { RoleNodeData, ChannelNodeData } from '../src/types/editor';

function resetStores() {
  useCanvasStore.getState().clear();
  useConfigStore.getState().clear();
  useHistoryStore.getState().clear();
  useValidationStore.getState().clear();
}

function loadGSD() {
  const tmpl = BUNDLED_TEMPLATES['gsd'];
  loadTemplate(tmpl.manifest, tmpl.roles);
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe('E2E: Component rendering', () => {
  beforeEach(() => {
    resetStores();
    cleanup();
  });

  describe('Toolbar', () => {
    it('renders all toolbar buttons', () => {
      loadGSD();
      renderWithProviders(<Toolbar />);

      expect(screen.getByTestId('toggle-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('btn-import')).toBeInTheDocument();
      expect(screen.getByTestId('btn-export')).toBeInTheDocument();
      expect(screen.getByTestId('btn-layout')).toBeInTheDocument();
      expect(screen.getByTestId('btn-undo')).toBeInTheDocument();
      expect(screen.getByTestId('btn-redo')).toBeInTheDocument();
      expect(screen.getByTestId('toggle-inspector')).toBeInTheDocument();
    });

    it('renders layer toggle buttons', () => {
      loadGSD();
      renderWithProviders(<Toolbar />);

      expect(screen.getByTestId('layer-peerRoutes')).toBeInTheDocument();
      expect(screen.getByTestId('layer-channels')).toBeInTheDocument();
      expect(screen.getByTestId('layer-spawnRules')).toBeInTheDocument();
      expect(screen.getByTestId('layer-inheritance')).toBeInTheDocument();
    });

    it('displays role and channel counts', () => {
      loadGSD();
      renderWithProviders(<Toolbar />);

      const status = screen.getByTestId('toolbar-status');
      expect(status.textContent).toContain('12 roles');
      expect(status.textContent).toContain('4 ch');
    });

    it('undo button is disabled when no history', () => {
      renderWithProviders(<Toolbar />);
      const undoBtn = screen.getByTestId('btn-undo');
      expect(undoBtn).toBeDisabled();
    });

    it('undo button is enabled after making changes', () => {
      loadGSD();
      renderWithProviders(<Toolbar />);

      // After loadTemplate, history has 1 entry
      const undoBtn = screen.getByTestId('btn-undo');
      expect(undoBtn).not.toBeDisabled();
    });

    it('clicking import opens import modal in UI store', () => {
      renderWithProviders(<Toolbar />);
      fireEvent.click(screen.getByTestId('btn-import'));
      expect(useUIStore.getState().importModalOpen).toBe(true);
    });

    it('clicking export opens export modal in UI store', () => {
      renderWithProviders(<Toolbar />);
      fireEvent.click(screen.getByTestId('btn-export'));
      expect(useUIStore.getState().exportModalOpen).toBe(true);
    });

    it('clicking sidebar toggle changes UI store', () => {
      renderWithProviders(<Toolbar />);
      const initial = useUIStore.getState().sidebarOpen;
      fireEvent.click(screen.getByTestId('toggle-sidebar'));
      expect(useUIStore.getState().sidebarOpen).toBe(!initial);
    });

    it('clicking layer toggle changes layer state', () => {
      renderWithProviders(<Toolbar />);
      const initial = useUIStore.getState().layers.spawnRules;
      fireEvent.click(screen.getByTestId('layer-spawnRules'));
      expect(useUIStore.getState().layers.spawnRules).toBe(!initial);
    });
  });

  describe('Sidebar', () => {
    it('renders add role and add channel buttons', () => {
      loadGSD();
      renderWithProviders(<Sidebar />);

      expect(screen.getByTestId('add-role')).toBeInTheDocument();
      expect(screen.getByTestId('add-channel')).toBeInTheDocument();
    });

    it('lists all roles from loaded template', () => {
      loadGSD();
      renderWithProviders(<Sidebar />);

      expect(screen.getByTestId('sidebar-role-orchestrator')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-role-executor')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-role-verifier')).toBeInTheDocument();
    });

    it('lists all channels from loaded template', () => {
      loadGSD();
      renderWithProviders(<Sidebar />);

      expect(screen.getByTestId('sidebar-channel-project_lifecycle')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-channel-planning_events')).toBeInTheDocument();
    });

    it('shows template selector with gsd option', () => {
      renderWithProviders(<Sidebar />);

      const select = screen.getByTestId('template-select') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      const options = Array.from(select.options).map(o => o.value);
      expect(options).toContain('gsd');
    });

    it('clicking add role creates a new role', () => {
      renderWithProviders(<Sidebar />);

      const initialRoleCount = useConfigStore.getState().roles.size;
      fireEvent.click(screen.getByTestId('add-role'));

      expect(useConfigStore.getState().roles.size).toBe(initialRoleCount + 1);
      expect(useCanvasStore.getState().nodes.length).toBe(1);
    });

    it('clicking add channel creates a new channel', () => {
      renderWithProviders(<Sidebar />);

      fireEvent.click(screen.getByTestId('add-channel'));

      expect(Object.keys(useConfigStore.getState().channels).length).toBe(1);
      expect(useCanvasStore.getState().nodes.length).toBe(1);
    });

    it('clicking a role in sidebar selects it on canvas', () => {
      loadGSD();
      renderWithProviders(<Sidebar />);

      fireEvent.click(screen.getByTestId('sidebar-role-orchestrator'));
      expect(useCanvasStore.getState().selectedNodeId).toBe('role-orchestrator');
    });

    it('clicking a channel in sidebar selects it on canvas', () => {
      loadGSD();
      renderWithProviders(<Sidebar />);

      fireEvent.click(screen.getByTestId('sidebar-channel-project_lifecycle'));
      expect(useCanvasStore.getState().selectedNodeId).toBe('channel-project_lifecycle');
    });

    it('selecting template from dropdown loads that template', () => {
      renderWithProviders(<Sidebar />);

      fireEvent.change(screen.getByTestId('template-select'), { target: { value: 'gsd' } });

      expect(useConfigStore.getState().team.name).toBe('gsd');
      expect(useConfigStore.getState().roles.size).toBe(12);
    });

    it('adding multiple roles creates unique names', () => {
      renderWithProviders(<Sidebar />);

      fireEvent.click(screen.getByTestId('add-role'));
      fireEvent.click(screen.getByTestId('add-role'));
      fireEvent.click(screen.getByTestId('add-role'));

      const roleNames = Array.from(useConfigStore.getState().roles.keys());
      // All names should be unique
      expect(new Set(roleNames).size).toBe(roleNames.length);
    });
  });

  describe('Inspector', () => {
    it('shows TeamInspector when nothing selected', () => {
      loadGSD();
      renderWithProviders(<Inspector />);

      expect(screen.getByTestId('team-inspector')).toBeInTheDocument();
    });

    it('shows RoleInspector when a role node is selected', () => {
      loadGSD();
      useCanvasStore.getState().setSelection('role-orchestrator', null);
      renderWithProviders(<Inspector />);

      expect(screen.getByTestId('role-inspector')).toBeInTheDocument();
      expect(screen.getByTestId('role-inspector-header')).toHaveTextContent('orchestrator');
    });

    it('shows ChannelInspector when a channel node is selected', () => {
      loadGSD();
      useCanvasStore.getState().setSelection('channel-project_lifecycle', null);
      renderWithProviders(<Inspector />);

      expect(screen.getByTestId('channel-inspector')).toBeInTheDocument();
      expect(screen.getByTestId('channel-inspector-header')).toHaveTextContent('project_lifecycle');
    });
  });

  describe('TeamInspector', () => {
    it('renders team name, description, and enforcement', () => {
      loadGSD();
      renderWithProviders(<TeamInspector />);

      const nameInput = screen.getByTestId('team-name') as HTMLInputElement;
      expect(nameInput.value).toBe('gsd');

      const enforcementSelect = screen.getByTestId('team-enforcement') as HTMLSelectElement;
      expect(enforcementSelect.value).toBe('permissive');
    });

    it('editing team name updates config store', () => {
      loadGSD();
      renderWithProviders(<TeamInspector />);

      const nameInput = screen.getByTestId('team-name') as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'my-team' } });

      expect(useConfigStore.getState().team.name).toBe('my-team');
    });

    it('changing enforcement updates config store', () => {
      loadGSD();
      renderWithProviders(<TeamInspector />);

      const select = screen.getByTestId('team-enforcement') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'strict' } });

      expect(useConfigStore.getState().team.enforcement).toBe('strict');
    });
  });

  describe('RoleInspector tabs and fields', () => {
    function renderRoleInspector() {
      loadGSD();
      useCanvasStore.getState().setSelection('role-orchestrator', null);
      renderWithProviders(<Inspector />);
    }

    it('renders role tabs', () => {
      renderRoleInspector();

      expect(screen.getByTestId('role-tab-identity')).toBeInTheDocument();
      expect(screen.getByTestId('role-tab-communication')).toBeInTheDocument();
      expect(screen.getByTestId('role-tab-capabilities')).toBeInTheDocument();
      expect(screen.getByTestId('role-tab-prompts')).toBeInTheDocument();
    });

    it('identity tab shows role name (read-only)', () => {
      renderRoleInspector();

      const nameInput = screen.getByTestId('role-name') as HTMLInputElement;
      expect(nameInput.value).toBe('orchestrator');
      expect(nameInput).toHaveAttribute('readonly');
    });

    it('identity tab shows topology position', () => {
      renderRoleInspector();

      const posSelect = screen.getByTestId('role-position') as HTMLSelectElement;
      expect(posSelect.value).toBe('root');
    });

    it('changing model updates both canvas and config', () => {
      renderRoleInspector();

      const modelSelect = screen.getByTestId('role-model') as HTMLSelectElement;
      fireEvent.change(modelSelect, { target: { value: 'opus' } });

      // Config store should have the model
      expect(useConfigStore.getState().roleModels['orchestrator']).toBe('opus');

      // Canvas node should have the model
      const node = useCanvasStore.getState().nodes.find(n => n.id === 'role-orchestrator');
      expect((node?.data as RoleNodeData).model).toBe('opus');
    });

    it('changing display name updates config store', () => {
      renderRoleInspector();

      const input = screen.getByTestId('role-display-name') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Super Orchestrator' } });

      expect(useConfigStore.getState().roles.get('orchestrator')?.displayName).toBe('Super Orchestrator');
    });

    it('clicking communication tab shows communication content', () => {
      renderRoleInspector();

      fireEvent.click(screen.getByTestId('role-tab-communication'));

      // Should show emits and subscribes sections
      expect(screen.getByText('Emits')).toBeInTheDocument();
      expect(screen.getByText('Subscribes to')).toBeInTheDocument();
    });

    it('clicking capabilities tab shows capabilities content', () => {
      renderRoleInspector();

      fireEvent.click(screen.getByTestId('role-tab-capabilities'));

      expect(screen.getByText('Capabilities')).toBeInTheDocument();
      expect(screen.getByText('Spawn Rules (can spawn)')).toBeInTheDocument();
    });

    it('clicking prompts tab shows prompt editor', () => {
      renderRoleInspector();

      fireEvent.click(screen.getByTestId('role-tab-prompts'));

      expect(screen.getByText('Primary Prompt (ROLE.md)')).toBeInTheDocument();
    });
  });

  describe('Full interaction flow', () => {
    it('load template → select role → edit → verify export', async () => {
      // Step 1: Load template via sidebar
      renderWithProviders(<Sidebar />);
      fireEvent.change(screen.getByTestId('template-select'), { target: { value: 'gsd' } });
      cleanup();

      expect(useConfigStore.getState().roles.size).toBe(12);

      // Step 2: Select orchestrator role
      useCanvasStore.getState().setSelection('role-orchestrator', null);

      // Step 3: Render inspector and edit
      renderWithProviders(<Inspector />);

      // Change display name
      const displayInput = screen.getByTestId('role-display-name') as HTMLInputElement;
      fireEvent.change(displayInput, { target: { value: 'Lead Agent' } });

      // Verify config store updated
      expect(useConfigStore.getState().roles.get('orchestrator')?.displayName).toBe('Lead Agent');

      // Set model
      const modelSelect = screen.getByTestId('role-model') as HTMLSelectElement;
      fireEvent.change(modelSelect, { target: { value: 'opus' } });

      expect(useConfigStore.getState().roleModels['orchestrator']).toBe('opus');
      cleanup();

      // Step 4: Verify export includes changes
      const { compileToYaml } = await import('../src/lib/compiler');
      const files = compileToYaml();
      const yaml = await import('js-yaml');
      const manifest = yaml.load(files.find((f: any) => f.path === 'team.yaml').content) as Record<string, any>;

      expect(manifest.topology.root.config?.model).toBe('opus');

      const roleDef = yaml.load(
        files.find((f: any) => f.path === 'roles/orchestrator.yaml').content
      ) as Record<string, any>;
      expect(roleDef.display_name).toBe('Lead Agent');
    });

    it('add role via sidebar → select → edit → add to spawn rules', () => {
      // Load base template
      loadGSD();

      // Add a new role via sidebar
      renderWithProviders(<Sidebar />);
      fireEvent.click(screen.getByTestId('add-role'));
      cleanup();

      // Find the new role name
      const newRoleName = Array.from(useConfigStore.getState().roles.keys()).find(
        name => !BUNDLED_TEMPLATES['gsd'].manifest.roles.includes(name)
      );
      expect(newRoleName).toBeDefined();

      // New role should be selected
      expect(useCanvasStore.getState().selectedNodeId).toBe(`role-${newRoleName}`);

      // Config should have 13 roles
      expect(useConfigStore.getState().roles.size).toBe(13);

      // Add new role to orchestrator's spawn rules
      const orchestratorSpawns = useConfigStore.getState().spawnRules['orchestrator'] || [];
      useConfigStore.getState().setSpawnRules('orchestrator', [...orchestratorSpawns, newRoleName!]);

      expect(useConfigStore.getState().spawnRules['orchestrator']).toContain(newRoleName);
    });
  });
});
