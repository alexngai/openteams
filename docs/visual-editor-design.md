# OpenTeams Visual Team Editor — Design Specification

## 1. Overview

A standalone browser-based visual editor for designing, visualizing, and exporting OpenTeams team configurations. Users compose team topologies, communication patterns, role definitions, and signal flows on an interactive graph canvas, then export valid `team.yaml` + `roles/*.yaml` files.

**Reference implementation**: The [self-driving-repo editor](https://github.com/alexngai/self-driving-repo/tree/main/editor) — a React Flow-based visual editor for DAG agent configs. Our editor adapts its architecture to handle OpenTeams' richer multi-layer relationship model (topology, communication, spawn rules, role inheritance).

### Goals

- Visualize complex inter-role relationships that are hard to reason about in raw YAML
- Provide a bidirectional editor: import existing templates, modify visually, export valid YAML
- Real-time validation with actionable error/warning feedback
- Support all existing templates (gsd, bmad-method) as proof of generalization
- Inline markdown editing for role prompts

### Non-Goals (v1)

- Runtime monitoring (live signal events, agent status) — this is a config editor, not a dashboard
- Direct filesystem write-back — export produces YAML for copy/download
- MCP server configuration UI — file path references only for v1

---

## 2. Architecture

### Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| React | 19.x | UI framework |
| @xyflow/react | 12.x | Graph canvas (React Flow) |
| Zustand | 5.x | State management (5 stores) |
| @dagrejs/dagre | 1.x | Hierarchical auto-layout |
| js-yaml | 4.x | YAML serialization |
| ajv | 8.x | JSON Schema validation (reuse existing schemas) |
| Vite | 6.x | Build tooling |
| Tailwind CSS | 4.x | Styling |
| TypeScript | 5.x | Type safety (strict mode) |

### Project Structure

```
editor/
├── src/
│   ├── App.tsx                          # Root layout + ReactFlowProvider
│   ├── main.tsx                         # Vite entry point
│   ├── index.css                        # Tailwind imports + CSS variables
│   │
│   ├── types/
│   │   └── editor.ts                    # Canvas-specific types (nodes, edges, data)
│   │
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── Canvas.tsx               # ReactFlow container, drag-drop, edge creation
│   │   │   └── QuickAddMenu.tsx         # Double-click context menu
│   │   │
│   │   ├── nodes/
│   │   │   ├── RoleNode.tsx             # Role node with capabilities, model, signal summary
│   │   │   ├── ChannelNode.tsx          # Channel node with signal list
│   │   │   └── node-styles.ts           # Color constants, topology-based styling
│   │   │
│   │   ├── edges/
│   │   │   ├── PeerRouteEdge.tsx        # Bold direct route with signal labels
│   │   │   ├── SignalFlowEdge.tsx       # Emission/subscription through channels
│   │   │   └── SpawnEdge.tsx            # Dashed "can spawn" relationship
│   │   │
│   │   ├── inspector/
│   │   │   ├── Inspector.tsx            # Dispatcher (role/channel/edge/team)
│   │   │   ├── RoleInspector.tsx        # Tabs: Identity, Communication, Capabilities
│   │   │   ├── ChannelInspector.tsx     # Signal list editor, emitter/subscriber summary
│   │   │   ├── EdgeInspector.tsx        # Signal/route details (read-only for derived)
│   │   │   ├── TeamInspector.tsx        # Name, enforcement, extension metadata
│   │   │   └── PromptEditor.tsx         # Inline markdown editor for role prompts
│   │   │
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx              # Block palette + config tree
│   │   │   ├── ConfigTree.tsx           # Hierarchical template view
│   │   │   └── TemplateGallery.tsx      # Load from bundled example templates
│   │   │
│   │   ├── toolbar/
│   │   │   ├── Toolbar.tsx              # Top action bar
│   │   │   ├── LayerToggle.tsx          # Toggle visibility of edge types
│   │   │   ├── ValidationBar.tsx        # Real-time validation status
│   │   │   ├── ImportModal.tsx          # YAML import dialog (paste or upload)
│   │   │   └── ExportModal.tsx          # Multi-file YAML preview + copy/download
│   │   │
│   │   └── shared/
│   │       ├── CapabilityInput.tsx       # Tag-style capability editor
│   │       ├── SignalPicker.tsx          # Autocomplete for signal names
│   │       ├── ArrayInput.tsx           # Generic multi-value input
│   │       └── ThemeToggle.tsx          # Dark/light mode switch
│   │
│   ├── stores/
│   │   ├── canvas-store.ts              # Nodes, edges, selection state
│   │   ├── config-store.ts              # Roles, channels, team metadata, prompts
│   │   ├── history-store.ts             # Undo/redo state snapshots
│   │   ├── validation-store.ts          # Errors/warnings per node
│   │   └── ui-store.ts                  # Panel visibility, active layers
│   │
│   ├── lib/
│   │   ├── serializer.ts               # Config <-> Canvas bidirectional conversion
│   │   ├── auto-layout.ts              # Dagre hierarchical layout
│   │   ├── validator.ts                # Schema + semantic validation (browser-safe)
│   │   ├── compiler.ts                 # Canvas -> multi-file YAML output
│   │   └── signal-catalog.ts           # Known signal name suggestions
│   │
│   └── hooks/
│       ├── use-validation.ts            # Debounced validation on state change
│       ├── use-keyboard.ts              # Ctrl+Z/Y, Delete, Ctrl+I shortcuts
│       └── use-autosave.ts              # localStorage persistence
│
├── tests/
│   ├── serializer.test.ts              # Round-trip conversion tests
│   ├── validator.test.ts               # Validation rule tests
│   └── compiler.test.ts                # YAML output tests
│
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

### Relationship to Main Package

The editor is a **standalone Vite app** in the `editor/` directory. It imports OpenTeams types via a path alias:

```typescript
// vite.config.ts
resolve: {
  alias: {
    '@openteams': path.resolve(__dirname, '../src'),
  },
}
```

This gives the editor access to `TeamManifest`, `CommunicationConfig`, `RoleDefinition`, etc. from `src/template/types.ts` without duplicating type definitions. The editor does not import any Node.js-specific code (database, services, spawner).

---

## 3. Data Model

### 3.1 Editor Types

```typescript
// types/editor.ts

// ── Node Data ──────────────────────────────────────────

interface RoleNodeData {
  kind: 'role';
  roleName: string;                    // Key in roles list
  displayName: string;                 // From role definition
  description: string;
  topologyPosition: 'root' | 'companion' | 'spawned';
  model?: string;                      // From topology node config
  capabilities: string[];
  extends?: string;                    // Parent role name
  emits: string[];                     // Signal names this role emits
  subscribesTo: SubscriptionSummary[]; // Channel+signal subscriptions
  peerRoutesOut: number;               // Count of outgoing peer routes
  peerRoutesIn: number;                // Count of incoming peer routes
  canSpawn: string[];                  // Roles this role can spawn
  errors: string[];                    // Validation errors
  warnings: string[];                  // Validation warnings
}

interface SubscriptionSummary {
  channel: string;
  signals: string[] | 'all';          // 'all' when no filter
}

interface ChannelNodeData {
  kind: 'channel';
  channelName: string;
  description: string;
  signals: string[];
  emitterCount: number;               // Derived: how many roles emit to this
  subscriberCount: number;            // Derived: how many roles subscribe
}

// ── Edge Data ──────────────────────────────────────────

interface PeerRouteEdgeData {
  kind: 'peer-route';
  signals: string[];                   // Signals carried on this route
  via: 'direct' | 'topic' | 'scope';
}

interface SignalFlowEdgeData {
  kind: 'signal-flow';
  direction: 'emission' | 'subscription';
  channel: string;
  signals: string[];                   // Specific signals, or all if empty
}

interface SpawnEdgeData {
  kind: 'spawn';
}

// ── Unions ─────────────────────────────────────────────

type EditorNode = Node<RoleNodeData, 'role'> | Node<ChannelNodeData, 'channel'>;
type EditorEdge =
  | Edge<PeerRouteEdgeData>
  | Edge<SignalFlowEdgeData>
  | Edge<SpawnEdgeData>;

// ── Canvas State ───────────────────────────────────────

interface CanvasState {
  nodes: EditorNode[];
  edges: EditorEdge[];
  viewport: { x: number; y: number; zoom: number };
}
```

### 3.2 Config Store Types

```typescript
// Stored separately from canvas (not embedded in node data)

interface EditorRoleConfig {
  name: string;
  displayName: string;
  description: string;
  extends?: string;
  capabilities: string[];
  promptContent?: string;             // Inline markdown (primary prompt)
  additionalPrompts?: { name: string; content: string }[];
}

interface EditorTeamConfig {
  name: string;
  description: string;
  version: 1;
  enforcement: 'strict' | 'permissive' | 'audit';
  extensions: Record<string, unknown>; // gsd:, bmad:, etc.
}
```

---

## 4. Visual Design

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Toolbar                                                          │
│  [=] New  Import  Export  |  Auto Layout  |  Undo Redo  |  [?]  │
│  Layer: [Peer Routes ✓] [Channels ✓] [Spawn Rules] [Inheritance] │
├────────────┬─────────────────────────────────┬───────────────────┤
│            │                                 │                   │
│  Sidebar   │         Canvas                  │    Inspector      │
│  (240px)   │      (React Flow)               │    (340px)        │
│            │                                 │                   │
│  Blocks    │   ┌──────────┐   ┌──────────┐   │  [Role Inspector] │
│  ────────  │   │ research │───│ roadmap  │   │                   │
│  ● Role    │   │ -synth.  │   │ -per     │   │  Identity         │
│  ◆ Channel │   └──────────┘   └──────────┘   │  Communication    │
│            │        │              │          │  Capabilities     │
│  Config    │   ┌────┴────┐   ┌────┴────┐     │  Prompts          │
│  ────────  │   │ planner │◄──│ plan-   │     │                   │
│  Tree view │   │         │──►│ checker │     │                   │
│            │   └─────────┘   └─────────┘     │                   │
│            │                                 │                   │
│  Gallery   │   Background grid + minimap     │                   │
│  ────────  │   Controls (zoom/fit)           │                   │
│  Templates │                                 │                   │
│            │                                 │                   │
├────────────┴─────────────────────────────────┴───────────────────┤
│  Validation Bar: ✓ 12 roles, 4 channels, 0 errors, 2 warnings   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Node Types

#### RoleNode

```
┌─────────────────────────────────────┐
│  ★ orchestrator               opus  │  ← topology badge + model
│  GSD Orchestrator                   │  ← display_name (muted)
├─────────────────────────────────────┤
│  command-routing · wave-orch. · +3  │  ← capabilities (truncated)
├─────────────────────────────────────┤
│  ▲ emits 3    ▼ subs 4    → routes 2│  ← signal summary
└─────────────────────────────────────┘
  ●                                 ●     ← handles (left=target, right=source)
```

**Topology-based styling:**

| Position | Border | Badge | Default Color |
|---|---|---|---|
| root | 2px solid | ★ | Blue (#3b82f6) |
| companion | 2px solid | ◆ | Teal (#14b8a6) |
| spawned | 1px dashed | (none) | Gray (#6b7280) |

**State-based border overrides:**
- Validation errors: red border
- Validation warnings: yellow border
- Selected: amber/orange border

#### ChannelNode

```
┌───────────────────────────────┐
│  ◆ planning_events            │
│  "Planning and research..."   │
├───────────────────────────────┤
│  RESEARCH_COMPLETE            │
│  ROADMAP_READY                │
│  PLAN_READY                   │
│  PLAN_VALIDATED               │
│  PLAN_REJECTED                │
├───────────────────────────────┤
│  3 emitters · 4 subscribers   │
└───────────────────────────────┘
```

**Styling:** Purple (#8b5cf6) border, smaller than role nodes. Rounded corners.

### 4.3 Edge Types

| Edge | Style | When Visible | Label |
|---|---|---|---|
| **PeerRouteEdge** | Bold (2.5px), colored (#f59e0b amber) | Layer: Peer Routes | Signal names |
| **SignalFlowEdge** | Medium (1.5px), muted (#6b7280) | Layer: Channels | Channel name |
| **SpawnEdge** | Thin dashed (1px), light gray | Layer: Spawn Rules | "can spawn" |

All edges use Bezier curves with invisible wider hit areas (16px) for hover/selection.

**PeerRouteEdge** is the highest-priority visual element — these represent the actual handoff patterns that drive workflow (e.g., `planner ↔ plan-checker` loop, `research-synthesizer → roadmapper` handoff).

**SignalFlowEdge** connects roles to/from channel nodes. These are medium priority — they show the pub/sub topology.

**SpawnEdge** is lowest priority and off by default — spawn rules are important for config but less relevant for understanding communication flow.

### 4.4 Layer System

The toolbar contains toggle buttons that control edge visibility:

| Layer | Default | Controls |
|---|---|---|
| Peer Routes | **ON** | PeerRouteEdge visibility |
| Channels | **ON** | ChannelNode + SignalFlowEdge visibility |
| Spawn Rules | OFF | SpawnEdge visibility |
| Inheritance | OFF | Dashed edge for `extends` relationships |

When **Channels** layer is OFF, channel nodes are hidden. Signal flow information is still available in the role inspector.

Layer state is stored in `ui-store` and persisted via autosave.

---

## 5. Stores

### 5.1 Canvas Store (`canvas-store.ts`)

```typescript
interface CanvasStore {
  // State
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // ReactFlow callbacks
  onNodesChange: OnNodesChange<EditorNode>;
  onEdgesChange: OnEdgesChange<EditorEdge>;

  // Actions
  setSelection(nodeId: string | null, edgeId: string | null): void;
  addNode(node: EditorNode): void;
  removeNode(nodeId: string): void;
  addEdge(edge: EditorEdge): void;
  removeEdge(edgeId: string): void;
  updateNodeData(nodeId: string, data: Partial<RoleNodeData | ChannelNodeData>): void;

  // Serialization
  loadFromConfig(manifest: TeamManifest, roles: Map<string, RoleDefinition>): void;
  applyAutoLayout(): void;
}
```

### 5.2 Config Store (`config-store.ts`)

```typescript
interface ConfigStore {
  // State
  team: EditorTeamConfig;
  roles: Map<string, EditorRoleConfig>;
  channels: Record<string, ChannelDefinition>;
  subscriptions: Record<string, SubscriptionEntry[]>;
  emissions: Record<string, string[]>;
  peerRoutes: PeerRoute[];
  spawnRules: Record<string, string[]>;
  topologyRoot: string;               // Role name of root
  topologyCompanions: string[];       // Role names of companions

  // Actions
  setTeam(team: Partial<EditorTeamConfig>): void;
  setRole(name: string, role: EditorRoleConfig): void;
  removeRole(name: string): void;
  renameRole(oldName: string, newName: string): void;
  setChannel(name: string, channel: ChannelDefinition): void;
  removeChannel(name: string): void;
  setSubscriptions(role: string, subs: SubscriptionEntry[]): void;
  setEmissions(role: string, signals: string[]): void;
  addPeerRoute(route: PeerRoute): void;
  removePeerRoute(index: number): void;
  setSpawnRules(role: string, canSpawn: string[]): void;
  setTopologyRoot(role: string): void;
  setTopologyCompanions(roles: string[]): void;

  // Serialization
  loadFromConfig(manifest: TeamManifest, roles: Map<string, RoleDefinition>): void;
  toManifest(): TeamManifest;
  toRoleDefinitions(): Map<string, RoleDefinition>;
}
```

### 5.3 History Store (`history-store.ts`)

```typescript
interface HistoryStore {
  undoStack: Snapshot[];              // Max 50
  redoStack: Snapshot[];
  pushSnapshot(): void;               // Deep-clone canvas + config stores
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

interface Snapshot {
  canvas: { nodes: EditorNode[]; edges: EditorEdge[] };
  config: { /* all config-store fields */ };
}
```

### 5.4 Validation Store (`validation-store.ts`)

```typescript
interface ValidationStore {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValidating: boolean;
  setResults(errors: ValidationIssue[], warnings: ValidationIssue[]): void;
}

interface ValidationIssue {
  path: string;                        // e.g. "communication.emissions.planner"
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;                     // For highlighting on canvas
}
```

### 5.5 UI Store (`ui-store.ts`)

```typescript
interface UIStore {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  importModalOpen: boolean;
  exportModalOpen: boolean;
  layers: {
    peerRoutes: boolean;              // default: true
    channels: boolean;                // default: true
    spawnRules: boolean;              // default: false
    inheritance: boolean;             // default: false
  };
  toggleSidebar(): void;
  toggleInspector(): void;
  toggleLayer(layer: keyof UIStore['layers']): void;
}
```

---

## 6. Serialization

### 6.1 Import: YAML -> Canvas

`serializer.ts: configToCanvas(manifest, roleDefinitions)`

**Input:** `TeamManifest` (parsed team.yaml) + `Map<string, RoleDefinition>` (parsed roles/*.yaml)

**Algorithm:**

```
1. Create RoleNodes
   For each role in manifest.roles:
     a. Look up RoleDefinition (if exists)
     b. Determine topology position:
        - manifest.topology.root.role → 'root'
        - manifest.topology.companions[].role → 'companion'
        - else → 'spawned'
     c. Extract model from topology node config (if exists)
     d. Look up emissions for this role
     e. Look up subscriptions for this role
     f. Count peer routes from/to this role
     g. Look up spawn rules for this role
     h. Create EditorNode with RoleNodeData

2. Create ChannelNodes
   For each channel in manifest.communication.channels:
     a. Count emitters (roles that emit any of this channel's signals)
     b. Count subscribers (roles with subscriptions to this channel)
     c. Create EditorNode with ChannelNodeData

3. Create PeerRouteEdges
   For each route in manifest.communication.routing.peers:
     a. Create edge: source=role-{from}, target=role-{to}
     b. Data: signals, via

4. Create SignalFlowEdges
   For each role in emissions:
     For each signal the role emits:
       a. Find which channel contains this signal
       b. Create edge: source=role-{role}, target=channel-{channel}
       c. Data: direction='emission', channel, signals
   For each role in subscriptions:
     For each subscription entry:
       a. Create edge: source=channel-{channel}, target=role-{role}
       b. Data: direction='subscription', channel, signals (or all)

5. Create SpawnEdges
   For each role in spawn_rules:
     For each target in spawn_rules[role]:
       a. Create edge: source=role-{role}, target=role-{target}
       b. Data: kind='spawn'

6. Apply dagre auto-layout
   Return CanvasState { nodes, edges, viewport }
```

### 6.2 Export: Canvas -> YAML

`compiler.ts: canvasToYaml(canvasStore, configStore)`

**Output:** `Map<string, string>` — filepath → YAML content

**Algorithm:**

```
1. Build team.yaml
   a. team name, description, version from config store
   b. roles: all role names from config store
   c. topology:
      root: { role: topologyRoot, config: { model } }
      companions: topologyCompanions.map(role => ({ role, config: { model } }))
      spawn_rules: from config store
   d. communication:
      enforcement: from config store
      channels: from config store
      subscriptions: from config store
      emissions: from config store
      routing.peers: from config store
   e. Extension fields: from config store (pass-through)
   f. Serialize with js-yaml

2. Build roles/<name>.yaml for each role
   a. name, display_name, description, capabilities
   b. extends (if set)
   c. Serialize with js-yaml

3. Build prompts (as content map, not files)
   For each role with promptContent:
     a. prompts/<role>/ROLE.md → promptContent
     b. Additional prompts → prompts/<role>/<name>.md

4. Return Map<filepath, content>
```

### 6.3 YAML Serialization Options

```typescript
yaml.dump(config, {
  lineWidth: -1,          // No auto-wrapping
  noRefs: true,           // No YAML anchors/aliases
  quotingType: '"',       // Double quotes when needed
  forceQuotes: false,     // Smart quoting
  sortKeys: false,        // Preserve insertion order
});
```

---

## 7. Validation

### 7.1 Validation Pipeline

Triggered on every state change (debounced 300ms via `use-validation` hook).

**Layer 1: JSON Schema** (AJV)
- Validate assembled config against `team.schema.json` and `role.schema.json`
- These schemas are already defined in `schema/` — reuse directly

**Layer 2: Topology Integrity**
- Exactly one root role
- Root and all companion roles exist in the roles list
- All roles referenced in spawn_rules exist in the roles list
- No role appears as both root and companion

**Layer 3: Communication Integrity**
- Every signal in emissions exists in at least one channel's signal list
- Every signal in subscription filters exists in its channel's signal list
- Every channel referenced in subscriptions exists in channels
- Every role in subscriptions/emissions exists in the roles list
- Peer route from/to roles exist in the roles list

**Layer 4: Inheritance Integrity**
- No circular `extends` chains
- Referenced parent roles exist
- Capability composition is valid (removed capabilities exist on parent)

**Layer 5: Semantic Warnings** (non-blocking)
- Roles with no subscriptions and not reachable via spawn rules from root
- Signals defined in a channel but never emitted by any role
- Signals defined in a channel but never subscribed to by any role
- Roles that emit signals but have no emission entry (permissive mode)
- Peer routes carrying signals not defined in any channel

### 7.2 Error Display

- **Per-node**: Error/warning badge count on node corners
- **Validation bar**: Summary in bottom toolbar ("12 roles, 4 channels, 0 errors, 2 warnings")
- **Inspector**: Detailed error list when node selected
- **Node highlighting**: Red/yellow border for nodes with errors/warnings

---

## 8. Inspector Panels

### 8.1 RoleInspector (4 tabs)

**Tab 1: Identity**
```
Name:           [orchestrator      ]
Display Name:   [GSD Orchestrator  ]
Description:    [Command-level...  ]
                [                  ]
Model:          [sonnet ▼]
Position:       [root ▼]  (root / companion / spawned)
Extends:        [— none — ▼]  (dropdown of other roles)
```

**Tab 2: Communication**
```
Emits:
  [PROJECT_INITIALIZED] [PHASE_STARTED] [WAVE_STARTED] [+]

Subscribes:
  ┌─────────────────────────────────────────┐
  │ project_lifecycle     (all signals)  [×]│
  │ planning_events       (all signals)  [×]│
  │ execution_events      (all signals)  [×]│
  │ verification_events   (all signals)  [×]│
  └─────────────────────────────────────────┘
  [+ Add Subscription]

Peer Routes (outgoing):
  → roadmapper via direct [RESEARCH_COMPLETE]
  [+ Add Route]

Peer Routes (incoming):
  ← verifier via direct [GAPS_FOUND]
```

**Tab 3: Capabilities**
```
Capabilities:
  [command-routing    ×]
  [wave-orchestration ×]
  [state-management   ×]
  [checkpoint-handling×]
  [context-budgeting  ×]
  [+ Add capability             ]

Spawn Rules (can spawn):
  [✓] roadmapper
  [✓] planner
  [✓] plan-checker
  [✓] executor
  [✓] verifier
  [ ] debugger
  ...
```

**Tab 4: Prompts**
```
Primary Prompt (ROLE.md):
  ┌─────────────────────────────────────────┐
  │ # GSD Orchestrator                      │
  │                                         │
  │ You are the command-level orchestrator   │
  │ for the GSD multi-agent system...       │
  │                                         │
  │ ## Responsibilities                     │
  │ - Route user commands to agent chains   │
  │ - Manage project state transitions      │
  │ ...                                     │
  └─────────────────────────────────────────┘

Additional Prompts:
  ┌─ SOUL.md ──────────────────────────────┐
  │ # Personality & Values                  │
  │ ...                                     │
  └─────────────────────────────────────────┘
  [+ Add Prompt Section]
```

The markdown editor is a plain `<textarea>` with monospace font and basic syntax highlighting (headers, bold, lists). Not a full WYSIWYG editor — keeps it simple and predictable for prompt authoring.

### 8.2 ChannelInspector

```
Name:           [planning_events    ]
Description:    [Planning and research workflow signals]

Signals:
  [RESEARCH_COMPLETE ] [×]
  [ROADMAP_READY     ] [×]
  [PLAN_READY        ] [×]
  [PLAN_VALIDATED    ] [×]
  [PLAN_REJECTED     ] [×]
  [+ Add Signal                    ]

Emitters (derived, read-only):
  project-researcher  → RESEARCH_COMPLETE
  roadmapper          → ROADMAP_READY
  planner             → PLAN_READY
  plan-checker        → PLAN_VALIDATED, PLAN_REJECTED

Subscribers (derived, read-only):
  orchestrator        ← all signals
  roadmapper          ← RESEARCH_COMPLETE
  planner             ← ROADMAP_READY, PLAN_REJECTED
  plan-checker        ← PLAN_READY
```

### 8.3 TeamInspector (nothing selected)

```
Team Name:      [gsd      ]
Description:    [GSD — prompt-native multi-agent...]
                [                                  ]
Version:        1 (read-only)
Enforcement:    [permissive ▼]

Extension Metadata:
  ┌─ gsd: ─────────────────────────────────┐
  │ context_management:                     │
  │   description: "Each spawned agent..."  │
  │   plan_budget: "50%"                    │
  │ execution_model:                        │
  │   type: "wave-based-parallel"           │
  │ ...                                     │
  └─────────────────────────────────────────┘
  (raw YAML editor, monospace textarea)
```

### 8.4 EdgeInspector

**For PeerRouteEdge:**
```
Type: Peer Route
From: [planner]  →  To: [plan-checker]
Via:  [direct ▼]
Signals:
  [PLAN_READY] [×]
  [+ Add Signal]
[Delete Route]
```

**For SignalFlowEdge (read-only):**
```
Type: Signal Flow (emission)
Role: planner
Channel: planning_events
Signal: PLAN_READY
(Modify in Role Inspector → Communication tab)
```

---

## 9. Interactions

### 9.1 Creating Nodes

**Drag from sidebar:**
1. Sidebar palette has draggable blocks: "Role" and "Channel"
2. User drags block onto canvas
3. `onDrop` handler parses MIME data, creates node at drop position
4. For Role: creates a default `EditorRoleConfig` in config store + `RoleNode` on canvas
5. For Channel: prompts for name, creates `ChannelDefinition` in config store + `ChannelNode` on canvas
6. Pushes history snapshot

**Double-click on canvas:**
1. Opens QuickAddMenu at mouse position
2. Options: "New Role", "New Channel"
3. Same creation flow as drag-and-drop

### 9.2 Creating Edges

**Peer route (drag handle to handle):**
1. User drags from a role's right handle to another role's left handle
2. `onConnect` callback fires, stores pending connection
3. SignalPicker dialog opens — user selects signals for this route
4. On confirm: creates PeerRouteEdge + updates config store (adds to peerRoutes)
5. Pushes history snapshot

**Signal flow edges are derived, not manually created.** They are computed from the config store's emissions and subscriptions. When a user adds an emission or subscription in the inspector, the corresponding edges appear automatically.

**Spawn edges are derived from spawn rules.** Updated via the role inspector's spawn rules checkboxes.

### 9.3 Selection

- Click node → select node, deselect edge
- Click edge → select edge, deselect node
- Click canvas background → deselect all → show TeamInspector
- Selection state in canvas store drives Inspector panel content

### 9.4 Deletion

- Select node/edge → press Delete/Backspace
- For RoleNode deletion:
  - Remove from config store (role, emissions, subscriptions, spawn rules, peer routes)
  - Remove all connected edges
  - Push history snapshot
- For ChannelNode deletion:
  - Remove channel definition
  - Remove all subscriptions referencing it
  - Remove all connected SignalFlowEdges
  - Push history snapshot
- For PeerRouteEdge deletion:
  - Remove from config store peerRoutes
  - Push history snapshot

### 9.5 Import

1. User clicks "Import" in toolbar → ImportModal opens
2. Two input methods:
   - **Paste YAML**: textarea for team.yaml content + separate textareas for role YAMLs
   - **Load Template**: dropdown of bundled example templates (gsd, bmad-method)
3. On confirm:
   - Parse YAML with js-yaml
   - Call `configToCanvas()` to build nodes + edges
   - Load into canvas store + config store
   - Apply auto-layout
   - Clear history, push initial snapshot

### 9.6 Export

1. User clicks "Export" in toolbar → ExportModal opens
2. Modal shows tabbed file preview:
   - Tab per output file: `team.yaml`, `roles/orchestrator.yaml`, `roles/planner.yaml`, ...
   - Each tab shows syntax-highlighted YAML
   - Prompt files shown as additional tabs: `prompts/orchestrator/ROLE.md`, etc.
3. Actions:
   - **Copy** (per file): copies individual file content to clipboard
   - **Copy All**: copies all files concatenated with `--- filename ---` separators
   - **Download ZIP**: bundles all files into a downloadable zip

---

## 10. Auto-Layout

### Algorithm

Uses `@dagrejs/dagre` with left-to-right hierarchical layout.

```typescript
// auto-layout.ts

const ROLE_NODE_WIDTH = 280;
const ROLE_NODE_HEIGHT = 120;
const CHANNEL_NODE_WIDTH = 220;
const CHANNEL_NODE_HEIGHT = 100;

function computeLayout(nodes: EditorNode[], edges: EditorEdge[]): EditorNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',         // Left-to-right
    ranksep: 140,           // Horizontal spacing between ranks
    nodesep: 60,            // Vertical spacing between nodes in same rank
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const isChannel = node.data.kind === 'channel';
    g.setNode(node.id, {
      width: isChannel ? CHANNEL_NODE_WIDTH : ROLE_NODE_WIDTH,
      height: isChannel ? CHANNEL_NODE_HEIGHT : ROLE_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    // Only layout based on visible edges (peer routes + signal flow)
    // Skip spawn edges to avoid pulling layout
    if (edge.data?.kind !== 'spawn') {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return nodes.map(node => {
    const pos = g.node(node.id);
    const isChannel = node.data.kind === 'channel';
    const w = isChannel ? CHANNEL_NODE_WIDTH : ROLE_NODE_WIDTH;
    const h = isChannel ? CHANNEL_NODE_HEIGHT : ROLE_NODE_HEIGHT;
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
```

The layout uses only peer routes and signal flow edges for positioning — spawn edges are excluded to prevent distorting the communication-centric layout.

---

## 11. Template Gallery

The editor bundles the existing example templates for quick loading:

```typescript
// Bundled as static JSON (compiled from YAML at build time)
const BUNDLED_TEMPLATES = {
  'gsd': { manifest: {...}, roles: {...} },
  'bmad-method': { manifest: {...}, roles: {...} },
};
```

The TemplateGallery component in the sidebar shows these as cards:

```
┌────────────────────────────────┐
│  gsd                 │
│  12 roles · 4 channels         │
│  Wave-based parallel execution  │
│  [Load]                        │
├────────────────────────────────┤
│  bmad-method                   │
│  10 roles · 4 channels         │
│  Full agile development team    │
│  [Load]                        │
└────────────────────────────────┘
```

---

## 12. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected node or edge |
| `Ctrl+I` / `Cmd+I` | Toggle inspector panel |
| `Ctrl+E` / `Cmd+E` | Open export modal |
| `Ctrl+Shift+L` | Apply auto-layout |
| `Escape` | Deselect / close modal |

---

## 13. Theme System

CSS custom properties for dark/light mode, following the SDR editor pattern:

```css
:root {
  --ot-bg: #ffffff;
  --ot-surface: #f9fafb;
  --ot-text: #111827;
  --ot-text-muted: #6b7280;
  --ot-border: #e5e7eb;
  --ot-accent: #f59e0b;           /* Amber for selection */
  --ot-role-root: #3b82f6;       /* Blue */
  --ot-role-companion: #14b8a6;  /* Teal */
  --ot-role-spawned: #6b7280;    /* Gray */
  --ot-channel: #8b5cf6;         /* Purple */
  --ot-peer-route: #f59e0b;      /* Amber */
  --ot-signal-flow: #6b7280;     /* Gray */
  --ot-spawn-edge: #d1d5db;      /* Light gray */
  --ot-error: #ef4444;
  --ot-warning: #eab308;
  --ot-success: #22c55e;
}

.dark {
  --ot-bg: #0f172a;
  --ot-surface: #1e293b;
  --ot-text: #f1f5f9;
  --ot-text-muted: #94a3b8;
  --ot-border: #334155;
  /* ... accent and semantic colors stay the same */
}
```

---

## 14. Phased Implementation Plan

### Phase 1: Foundation (scaffold, types, canvas, basic nodes)

**Goal:** Standalone Vite app with React Flow canvas that renders role and channel nodes from hardcoded data.

**Tasks:**
1. Scaffold `editor/` directory with Vite + React + TypeScript + Tailwind
2. Configure `vite.config.ts` with `@openteams` path alias to `../src`
3. Create `package.json` with all dependencies
4. Define editor types in `types/editor.ts` (RoleNodeData, ChannelNodeData, edge data types)
5. Implement `RoleNode.tsx` — memoized custom node with topology styling, capability summary, signal counts
6. Implement `ChannelNode.tsx` — memoized custom node with signal list, emitter/subscriber counts
7. Implement `Canvas.tsx` — ReactFlow container with node type registration, background grid, controls, minimap
8. Implement `App.tsx` — root layout shell (sidebar placeholder, canvas, inspector placeholder)
9. Create `node-styles.ts` — color constants, topology-based style functions
10. Create CSS variables for theming (`index.css`)

**Verification:** `npm run dev` renders a canvas with sample hardcoded role + channel nodes.

### Phase 2: State Management (stores, serializer, auto-layout)

**Goal:** Import a team.yaml + roles and render it on the canvas with auto-layout.

**Tasks:**
1. Implement `canvas-store.ts` — nodes, edges, selection, ReactFlow callbacks
2. Implement `config-store.ts` — roles, channels, subscriptions, emissions, peer routes, spawn rules, topology
3. Implement `history-store.ts` — undo/redo with snapshot deep-clone
4. Implement `ui-store.ts` — sidebar, inspector, layers, modals
5. Implement `validation-store.ts` — errors, warnings, isValidating
6. Implement `serializer.ts: configToCanvas()` — full import pipeline (roles → nodes, communication → edges)
7. Implement `auto-layout.ts: computeLayout()` — dagre LR layout with role/channel sizing
8. Wire up canvas store to use serializer + layout for `loadFromConfig()`
9. Bundle example templates (gsd, bmad-method) as static JSON
10. Load gsd on startup as default, verify all nodes + edges render correctly
11. Write round-trip tests for serializer: `configToCanvas` → `canvasToConfig` → assert structural equality

**Verification:** Both gsd (12 roles, 4 channels) and bmad-method (10 roles, 4 channels) render correctly with auto-layout. All node types, edge types, and topology positions display properly.

### Phase 3: Edge Types + Layer System

**Goal:** Three distinct edge types with layer toggles to manage visual complexity.

**Tasks:**
1. Implement `PeerRouteEdge.tsx` — bold amber Bezier with signal labels, hover animation
2. Implement `SignalFlowEdge.tsx` — medium gray Bezier with channel label, emission/subscription direction indicator
3. Implement `SpawnEdge.tsx` — thin dashed gray with "can spawn" tooltip
4. Implement `LayerToggle.tsx` — toolbar toggle buttons for 4 layers
5. Wire layer visibility to edge filtering in Canvas (filter edges by `data.kind` + layer state)
6. Wire channel node visibility to the Channels layer toggle
7. Ensure selection works across all edge types
8. Implement `EdgeInspector.tsx` — display edge details, editable for peer routes

**Verification:** Toggling layers hides/shows the correct edges. GSD template's 5 peer routes are visually distinct from signal flow edges. Spawn rules can be toggled on to see the orchestrator's spawn tree.

### Phase 4: Inspector + Editing

**Goal:** Full property editing via inspector panels. Changes flow back to stores and canvas.

**Tasks:**
1. Implement `Inspector.tsx` — dispatcher based on selection state
2. Implement `RoleInspector.tsx` — 4 tabs (Identity, Communication, Capabilities, Prompts)
3. Implement `ChannelInspector.tsx` — signal list editor, derived emitter/subscriber lists
4. Implement `TeamInspector.tsx` — team metadata + raw YAML extension editor
5. Implement `PromptEditor.tsx` — monospace textarea for markdown prompt content
6. Implement shared inputs: `CapabilityInput.tsx`, `SignalPicker.tsx`, `ArrayInput.tsx`
7. Wire inspector edits back to config store → trigger derived edge recomputation
8. Implement derived edge recomputation: when emissions/subscriptions change, rebuild SignalFlowEdges
9. Connect history store: push snapshots before each inspector edit

**Verification:** Select a role, edit its emissions in the inspector → signal flow edges update on canvas. Edit capabilities → node display updates. Write prompt content → stored in config store.

### Phase 5: Canvas Interactions (create, connect, delete)

**Goal:** Full interactive editing on the canvas itself.

**Tasks:**
1. Implement drag-and-drop from sidebar palette (Role + Channel blocks)
2. Implement `QuickAddMenu.tsx` — double-click to add nodes
3. Implement edge creation: drag handle → handle → SignalPicker dialog → create PeerRouteEdge
4. Implement node/edge deletion via Delete key
5. Implement `Sidebar.tsx` with block palette and `ConfigTree.tsx` for hierarchical view
6. Implement `TemplateGallery.tsx` — load bundled templates
7. Wire all interactions to history store for undo/redo
8. Implement `use-keyboard.ts` — keyboard shortcuts

**Verification:** Create a new team from scratch by dragging roles and channels, connecting peer routes, and editing properties. Undo/redo works across all operations.

### Phase 6: Validation

**Goal:** Real-time validation with per-node error/warning display.

**Tasks:**
1. Implement `validator.ts` — 5-layer validation pipeline (browser-safe, no fs)
2. Import existing JSON schemas (`team.schema.json`, `role.schema.json`) for AJV validation
3. Implement `use-validation.ts` hook — debounced 300ms, triggers on store changes
4. Wire validation results to node data (update error/warning counts on nodes)
5. Implement `ValidationBar.tsx` — bottom status bar with summary counts
6. Add error/warning border styling to RoleNode and ChannelNode
7. Write validation tests covering all 5 layers

**Verification:** Delete a channel that has subscribers → error appears on subscribing roles. Add a signal to emissions that doesn't exist in any channel → warning. Circular inheritance → error.

### Phase 7: Import/Export

**Goal:** Full YAML import and multi-file export.

**Tasks:**
1. Implement `compiler.ts: canvasToYaml()` — convert stores to multi-file YAML output
2. Implement `ImportModal.tsx` — paste YAML or load template
3. Implement `ExportModal.tsx` — tabbed file preview with copy + download
4. Implement multi-file YAML parsing for import (team.yaml + individual role YAMLs)
5. Add "New" button that resets all stores
6. Implement `signal-catalog.ts` — collect all known signal names for autocomplete
7. Implement `use-autosave.ts` — localStorage persistence
8. Implement `ThemeToggle.tsx` — dark/light mode
9. Write compiler tests: build config → compile → parse output → assert matches input

**Verification:** Import gsd template → edit roles → export → resulting YAML is valid and matches expected structure. Auto-save persists across browser refresh.

### Phase 8: Polish + Testing

**Goal:** Production-quality UX, comprehensive tests, and documentation.

**Tasks:**
1. Refine auto-layout for both template topologies (verify GSD and BMAD render cleanly)
2. Add hover states, transitions, and animations to edges
3. Responsive sidebar/inspector (collapsible on narrow viewports)
4. Add validation for real-time feedback as user types (debounced input validation)
5. Add "Fit View" button and initial viewport positioning
6. Cross-browser testing (Chrome, Firefox, Safari)
7. Write integration tests: full round-trip (import → edit → export → reimport → verify)
8. Add `npm run dev` and `npm run build` scripts + verify production build
9. Update project README and CLAUDE.md with editor documentation
10. Add `openteams editor` CLI command that launches `vite dev` for the editor

---

## Appendix A: Example Visualizations

### A.1 gsd (Peer Routes + Channels ON)

```
                                                ┌──────────────────┐
                                           ┌───→│ [planning_events]│───→ orchestrator
    ┌────────────────┐   ┌──────────────┐  │    │ RESEARCH_COMPLETE│───→ roadmapper
    │ project-       │──→│ research-    │──┘    │ ROADMAP_READY    │───→ planner
    │ researcher     │   │ synthesizer  │═══════│ PLAN_READY       │───→ plan-checker
    ├────────────────┤   └──────────────┘       │ PLAN_VALIDATED   │
    │ phase-         │                          │ PLAN_REJECTED    │───→ planner
    │ researcher     │──→ (also emits           └──────────────────┘
    ├────────────────┤    RESEARCH_COMPLETE)
    │ codebase-      │                    ┌─────────────────────────┐
    │ mapper         │──→ ...             │ planner ◄══PLAN_REJECTED══ plan-checker
    └────────────────┘                    │ planner ══PLAN_READY══► plan-checker
                                          │ verifier ══GAPS_FOUND══► planner
 ┌──────────────┐                         └─────────────────────────┘
 │ ★ orchestrator│                            (peer route loop)
 │ (root)        │──emit──→ [project_lifecycle] ──sub──→ verifier
 └──────────────┘          [execution_events]  ──sub──→ executor
                                                        integration-checker
```

### A.2 bmad-method (Peer Routes + Channels ON)

```
  ┌──────────┐    ┌────────┐    ┌─────────────┐    ┌──────────────┐
  │ ★ master │    │ analyst│═══►│ pm          │═══►│ architect    │
  │ (root)   │    │        │    │             │    │              │
  └──────────┘    └────────┘    └──────┬──────┘    └──────┬───────┘
       │                               │                   │
       │                          ┌────┴─────┐       ┌─────┴──────┐
       │                          │ux-designer│      │ scrum-master│
       │                          └──────────┘       └──────┬──────┘
       │                                                    │
       │                                              ┌─────┴──────┐
       │                                              │  developer │◄═══►
       │                                              └─────┬──────┘
       │                                                    │
       │              ┌────────────┐                  ┌─────┴──┐
       │              │ tech-writer│                  │   qa   │
       │              └────────────┘                  └────────┘
       │
  ┌────┴──────────┐
  │ quick-flow-dev│  (standalone)
  └───────────────┘
```

### A.3 Node ID Conventions

```
Nodes:   role-{roleName}         e.g. role-orchestrator, role-planner
         channel-{channelName}   e.g. channel-planning_events

Edges:   peer-{from}-{to}-{index}     e.g. peer-planner-plan-checker-0
         emit-{role}-{channel}         e.g. emit-planner-planning_events
         sub-{channel}-{role}          e.g. sub-planning_events-planner
         spawn-{from}-{to}             e.g. spawn-orchestrator-planner
```

---

## Appendix B: Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Channel nodes default visibility | ON (hidden = default OFF was considered) | Showing channels makes the pub/sub topology explicit; users can toggle off if noisy |
| Extension metadata editor | Raw YAML textarea | Structured editors for gsd:/bmad: are low ROI for v1; schemas vary per system |
| Prompt editing | Inline markdown textarea | Full WYSIWYG is overkill for prompt authoring; monospace textarea is closer to the file format |
| Signal flow edges | Derived from config, not manually drawn | Manual edge creation for subscriptions/emissions would duplicate the inspector workflow and create sync issues |
| Spawn edges | Hidden by default | Spawn rules add visual noise; less relevant for understanding communication flow |
| Layout algorithm | Dagre LR, spawn edges excluded | LR matches the natural left-to-right flow; excluding spawn edges prevents layout distortion |
| State management | Zustand (5 stores) | Matches SDR pattern, lightweight, no boilerplate |
| Multi-file export | Tabbed preview + zip download | OpenTeams configs are multi-file (team.yaml + roles/*.yaml + prompts/); single-file export wouldn't be useful |
