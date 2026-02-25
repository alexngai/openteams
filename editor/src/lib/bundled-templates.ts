import type { TeamManifest, RoleDefinition } from '@openteams/template/types';

export interface BundledTemplate {
  manifest: TeamManifest;
  roles: Map<string, RoleDefinition>;
}

const gsdManifest: TeamManifest = {
  name: 'get-shit-done',
  description: 'GSD \u2014 prompt-native multi-agent system for autonomous codebase development with wave-based parallel execution, goal-backward verification, and checkpoint-based context management',
  version: 1,
  roles: [
    'orchestrator', 'roadmapper', 'planner', 'plan-checker', 'executor', 'verifier',
    'project-researcher', 'phase-researcher', 'research-synthesizer', 'codebase-mapper',
    'debugger', 'integration-checker',
  ],
  topology: {
    root: { role: 'orchestrator', prompt: 'prompts/orchestrator.md' },
    companions: [
      { role: 'roadmapper', prompt: 'prompts/roadmapper.md' },
      { role: 'verifier', prompt: 'prompts/verifier.md' },
    ],
    spawn_rules: {
      orchestrator: ['roadmapper', 'planner', 'plan-checker', 'executor', 'verifier', 'project-researcher', 'phase-researcher', 'research-synthesizer', 'codebase-mapper', 'debugger', 'integration-checker'],
      planner: [], 'plan-checker': [], executor: [], verifier: [], roadmapper: [],
      'project-researcher': [], 'phase-researcher': [], 'research-synthesizer': [],
      'codebase-mapper': [], debugger: [], 'integration-checker': [],
    },
  },
  communication: {
    enforcement: 'permissive',
    channels: {
      project_lifecycle: {
        description: 'High-level project state transitions',
        signals: ['PROJECT_INITIALIZED', 'PHASE_STARTED', 'PHASE_COMPLETE', 'MILESTONE_COMPLETE'],
      },
      planning_events: {
        description: 'Planning and research workflow signals',
        signals: ['RESEARCH_COMPLETE', 'ROADMAP_READY', 'PLAN_READY', 'PLAN_VALIDATED', 'PLAN_REJECTED'],
      },
      execution_events: {
        description: 'Task execution and wave coordination',
        signals: ['WAVE_STARTED', 'TASK_COMPLETE', 'WAVE_COMPLETE', 'CHECKPOINT_REACHED', 'DEVIATION_DETECTED'],
      },
      verification_events: {
        description: 'Quality verification and gap detection',
        signals: ['VERIFICATION_PASSED', 'GAPS_FOUND', 'UAT_COMPLETE', 'INTEGRATION_VERIFIED'],
      },
    },
    subscriptions: {
      orchestrator: [
        { channel: 'project_lifecycle' },
        { channel: 'planning_events' },
        { channel: 'execution_events' },
        { channel: 'verification_events' },
      ],
      roadmapper: [{ channel: 'planning_events', signals: ['RESEARCH_COMPLETE'] }],
      planner: [
        { channel: 'planning_events', signals: ['ROADMAP_READY', 'PLAN_REJECTED'] },
        { channel: 'verification_events', signals: ['GAPS_FOUND'] },
      ],
      'plan-checker': [{ channel: 'planning_events', signals: ['PLAN_READY'] }],
      executor: [{ channel: 'execution_events', signals: ['WAVE_STARTED'] }],
      verifier: [
        { channel: 'execution_events', signals: ['WAVE_COMPLETE'] },
        { channel: 'project_lifecycle', signals: ['PHASE_COMPLETE'] },
      ],
      'integration-checker': [{ channel: 'project_lifecycle', signals: ['PHASE_COMPLETE'] }],
    },
    emissions: {
      orchestrator: ['PROJECT_INITIALIZED', 'PHASE_STARTED', 'WAVE_STARTED'],
      roadmapper: ['ROADMAP_READY'],
      planner: ['PLAN_READY'],
      'plan-checker': ['PLAN_VALIDATED', 'PLAN_REJECTED'],
      executor: ['TASK_COMPLETE', 'WAVE_COMPLETE', 'CHECKPOINT_REACHED', 'DEVIATION_DETECTED'],
      verifier: ['VERIFICATION_PASSED', 'GAPS_FOUND', 'UAT_COMPLETE'],
      'project-researcher': ['RESEARCH_COMPLETE'],
      'phase-researcher': ['RESEARCH_COMPLETE'],
      'research-synthesizer': ['RESEARCH_COMPLETE'],
      'codebase-mapper': ['RESEARCH_COMPLETE'],
      'integration-checker': ['INTEGRATION_VERIFIED'],
    },
    routing: {
      peers: [
        { from: 'research-synthesizer', to: 'roadmapper', via: 'direct', signals: ['RESEARCH_COMPLETE'] },
        { from: 'planner', to: 'plan-checker', via: 'direct', signals: ['PLAN_READY'] },
        { from: 'plan-checker', to: 'planner', via: 'direct', signals: ['PLAN_REJECTED'] },
        { from: 'verifier', to: 'planner', via: 'direct', signals: ['GAPS_FOUND'] },
        { from: 'integration-checker', to: 'planner', via: 'direct', signals: ['GAPS_FOUND'] },
      ],
    },
  },
  gsd: {
    context_management: {
      description: 'Each spawned agent gets fresh context. Orchestrator budgets ~15% for itself, agents get ~85%.',
      plan_budget: '50%',
      quality_threshold: '70%',
    },
    execution_model: {
      type: 'wave-based-parallel',
      description: 'Tasks grouped into dependency waves. Each wave\'s tasks run in parallel. Waves run sequentially.',
    },
    checkpoint_protocol: {
      types: ['human-verify', 'decision', 'human-action'],
      description: 'Executor pauses at checkpoints, returns structured state. User responds, next executor loads state and continues.',
    },
    commit_strategy: 'atomic-per-task',
    verification_methodology: 'goal-backward',
    workflows: {
      new_project: ['project-researcher', 'research-synthesizer', 'roadmapper', 'verifier'],
      plan_phase: ['phase-researcher', 'planner', 'plan-checker'],
      execute_phase: ['executor'],
      verify_work: ['verifier'],
      debug: ['debugger'],
      map_codebase: ['codebase-mapper'],
    },
    state_files: ['PROJECT.md', 'REQUIREMENTS.md', 'ROADMAP.md', 'STATE.md', 'CONTEXT.md', 'PLAN.md', 'VERIFICATION.md'],
  },
};

const gsdRoles = new Map<string, RoleDefinition>([
  ['orchestrator', { name: 'orchestrator', display_name: 'GSD Orchestrator', description: 'Command-level orchestrator. Routes user commands to agent chains, manages project state, spawns agents in dependency-aware waves, handles checkpoint resumption.', capabilities: ['command-routing', 'wave-orchestration', 'state-management', 'checkpoint-handling', 'context-budgeting'] }],
  ['roadmapper', { name: 'roadmapper', display_name: 'GSD Roadmapper', description: 'Converts research into phased ROADMAP.md. Defines feature milestones and phase ordering. Runs once after initial research completes.', capabilities: ['roadmap-creation', 'phase-sequencing', 'milestone-definition'] }],
  ['planner', { name: 'planner', display_name: 'GSD Planner', description: 'Decomposes phases into 2-3 parallel tasks with dependency graphs. Applies goal-backward methodology. Sizes tasks for 15-60 min agent execution. Produces PLAN.md.', capabilities: ['task-decomposition', 'dependency-analysis', 'goal-backward-planning', 'vertical-slice-design'] }],
  ['plan-checker', { name: 'plan-checker', display_name: 'GSD Plan Checker', description: 'Validates PLAN.md against ROADMAP.md and requirements. Checks task sizing, dependency sanity, coverage completeness. Returns PLAN_VALIDATED or PLAN_REJECTED.', capabilities: ['plan-validation', 'requirement-coverage', 'dependency-verification'] }],
  ['executor', { name: 'executor', display_name: 'GSD Executor', description: 'Atomically executes PLAN.md tasks. Handles deviations via 4 rules (security, validation, blocking, discretionary). Commits per task. Pauses at checkpoints.', capabilities: ['task-execution', 'deviation-handling', 'atomic-commits', 'checkpoint-management'] }],
  ['verifier', { name: 'verifier', display_name: 'GSD Verifier', description: 'Goal-backward verification. Checks each PLAN.md task\'s acceptance criteria against implementation. Produces VERIFICATION.md with pass/fail/gap analysis.', capabilities: ['goal-backward-verification', 'acceptance-testing', 'gap-analysis'] }],
  ['project-researcher', { name: 'project-researcher', display_name: 'GSD Project Researcher', description: 'Researches project requirements from user input, documentation, and existing codebase context. Produces structured research output.', capabilities: ['requirements-research', 'documentation-analysis'] }],
  ['phase-researcher', { name: 'phase-researcher', display_name: 'GSD Phase Researcher', description: 'Researches specific phase requirements. Identifies patterns, constraints, and risks relevant to the planning phase.', capabilities: ['phase-research', 'pattern-identification'] }],
  ['research-synthesizer', { name: 'research-synthesizer', display_name: 'GSD Research Synthesizer', description: 'Integrates 4 parallel researcher outputs into cohesive SUMMARY.md for roadmapper consumption. Resolves conflicts between research findings.', capabilities: ['research-synthesis', 'conflict-resolution', 'summary-generation'] }],
  ['codebase-mapper', { name: 'codebase-mapper', display_name: 'GSD Codebase Mapper', description: 'Maps codebase structure, patterns, and conventions. Identifies tech stack, architecture patterns, test frameworks, and coding standards.', capabilities: ['codebase-analysis', 'pattern-detection', 'convention-mapping'] }],
  ['debugger', { name: 'debugger', display_name: 'GSD Debugger', description: 'Diagnoses and fixes failures identified during verification. Analyzes error context, proposes fixes, and validates corrections.', capabilities: ['debugging', 'error-analysis', 'fix-validation'] }],
  ['integration-checker', { name: 'integration-checker', display_name: 'GSD Integration Checker', description: 'Verifies cross-task integration after phase completion. Checks that independently developed components work together correctly.', capabilities: ['integration-testing', 'cross-component-verification'] }],
]);

const bmadManifest: TeamManifest = {
  name: 'bmad-method',
  description: 'BMAD Method \u2014 full agile development team with 10 specialized agents across 4 phases (analysis, planning, solutioning, implementation) plus a quick-flow lane',
  version: 1,
  roles: ['master', 'analyst', 'pm', 'ux-designer', 'architect', 'scrum-master', 'developer', 'qa', 'tech-writer', 'quick-flow-dev'],
  topology: {
    root: { role: 'master', prompt: 'prompts/master.md' },
    companions: [
      { role: 'analyst', prompt: 'prompts/analyst.md' },
      { role: 'pm', prompt: 'prompts/pm.md' },
      { role: 'ux-designer', prompt: 'prompts/ux-designer.md' },
      { role: 'architect', prompt: 'prompts/architect.md' },
      { role: 'scrum-master', prompt: 'prompts/scrum-master.md' },
    ],
    spawn_rules: {
      master: ['analyst', 'pm', 'ux-designer', 'architect', 'scrum-master', 'developer', 'qa', 'tech-writer', 'quick-flow-dev'],
      'scrum-master': ['developer', 'qa', 'tech-writer'],
      pm: ['ux-designer'],
      analyst: [], 'ux-designer': [], architect: [], developer: [], qa: [], 'tech-writer': [], 'quick-flow-dev': [],
    },
  },
  communication: {
    enforcement: 'audit',
    channels: {
      phase_transitions: {
        description: 'Signals when a development phase completes and the next can begin',
        signals: ['ANALYSIS_COMPLETE', 'PLANNING_COMPLETE', 'SOLUTIONING_COMPLETE', 'IMPLEMENTATION_COMPLETE'],
      },
      artifact_ready: {
        description: 'Signals when a key artifact is produced and available for downstream consumers',
        signals: ['BRIEF_READY', 'PRD_READY', 'UX_SPEC_READY', 'ARCHITECTURE_READY', 'STORIES_READY', 'READINESS_GATE_PASSED'],
      },
      sprint_events: {
        description: 'Sprint lifecycle events during implementation phase',
        signals: ['SPRINT_STARTED', 'STORY_READY', 'STORY_COMPLETE', 'REVIEW_PASSED', 'REVIEW_FAILED', 'SPRINT_COMPLETE'],
      },
      quality_events: {
        description: 'Quality gates and test results',
        signals: ['TESTS_PASSED', 'TESTS_FAILED', 'DOCS_UPDATED'],
      },
    },
    subscriptions: {
      master: [
        { channel: 'phase_transitions' },
        { channel: 'artifact_ready' },
        { channel: 'sprint_events' },
        { channel: 'quality_events' },
      ],
      pm: [
        { channel: 'phase_transitions', signals: ['ANALYSIS_COMPLETE'] },
        { channel: 'artifact_ready', signals: ['BRIEF_READY'] },
      ],
      'ux-designer': [{ channel: 'artifact_ready', signals: ['PRD_READY'] }],
      architect: [{ channel: 'artifact_ready', signals: ['PRD_READY', 'UX_SPEC_READY'] }],
      'scrum-master': [
        { channel: 'artifact_ready', signals: ['ARCHITECTURE_READY', 'STORIES_READY', 'READINESS_GATE_PASSED'] },
        { channel: 'sprint_events' },
        { channel: 'quality_events' },
      ],
      developer: [{ channel: 'sprint_events', signals: ['STORY_READY', 'REVIEW_FAILED'] }],
      qa: [{ channel: 'sprint_events', signals: ['STORY_COMPLETE'] }],
      'tech-writer': [
        { channel: 'artifact_ready' },
        { channel: 'sprint_events', signals: ['STORY_COMPLETE', 'SPRINT_COMPLETE'] },
      ],
    },
    emissions: {
      analyst: ['ANALYSIS_COMPLETE', 'BRIEF_READY'],
      pm: ['PLANNING_COMPLETE', 'PRD_READY', 'STORIES_READY', 'READINESS_GATE_PASSED'],
      'ux-designer': ['UX_SPEC_READY'],
      architect: ['SOLUTIONING_COMPLETE', 'ARCHITECTURE_READY'],
      'scrum-master': ['SPRINT_STARTED', 'STORY_READY', 'SPRINT_COMPLETE'],
      developer: ['STORY_COMPLETE'],
      qa: ['TESTS_PASSED', 'TESTS_FAILED'],
      'tech-writer': ['DOCS_UPDATED'],
      'quick-flow-dev': ['STORY_COMPLETE'],
    },
    routing: {
      peers: [
        { from: 'analyst', to: 'pm', via: 'direct', signals: ['BRIEF_READY'] },
        { from: 'pm', to: 'architect', via: 'direct', signals: ['PRD_READY'] },
        { from: 'ux-designer', to: 'architect', via: 'direct', signals: ['UX_SPEC_READY'] },
        { from: 'scrum-master', to: 'developer', via: 'direct', signals: ['STORY_READY'] },
        { from: 'developer', to: 'scrum-master', via: 'direct', signals: ['STORY_COMPLETE'] },
        { from: 'developer', to: 'qa', via: 'direct' },
        { from: 'architect', to: 'developer', via: 'direct', signals: ['REVIEW_PASSED', 'REVIEW_FAILED'] },
      ],
    },
  },
  bmad: {
    phases: {
      analysis: { lead: 'analyst', optional: true, workflows: ['brainstorm-project', 'market-research', 'domain-research', 'technical-research', 'create-product-brief'] },
      planning: { lead: 'pm', parallel: ['ux-designer'], workflows: ['create-prd', 'validate-prd', 'create-ux-design'] },
      solutioning: { lead: 'architect', workflows: ['create-architecture', 'create-epics-and-stories', 'implementation-readiness'] },
      implementation: { orchestrator: 'scrum-master', executors: ['developer', 'qa', 'tech-writer'], workflows: ['sprint-planning', 'create-story', 'dev-story', 'code-review', 'automate-tests'] },
    },
    quick_flow: { agent: 'quick-flow-dev', parallel_to_all: true, workflows: ['quick-spec', 'quick-dev', 'code-review'] },
    party_mode: { orchestrator: 'master', description: 'Multi-agent collaborative discussion for big decisions, brainstorming, and retrospectives' },
  },
};

const bmadRoles = new Map<string, RoleDefinition>([
  ['master', { name: 'master', display_name: 'BMad Master', description: 'Workflow orchestrator and master task executor. Routes work to specialized agents, manages phase transitions, and runs party-mode collaborative sessions.', capabilities: ['workflow-orchestration', 'phase-management', 'agent-routing', 'party-mode'] }],
  ['analyst', { name: 'analyst', display_name: 'Larry (Analyst)', description: 'Business analyst and problem domain researcher. Conducts market research, technical analysis, and produces the foundational product brief.', capabilities: ['market-research', 'domain-analysis', 'requirements-gathering', 'product-brief-creation'] }],
  ['pm', { name: 'pm', display_name: 'Curly (Product Manager)', description: 'Product manager. Transforms the brief into a detailed PRD, defines user stories, and manages the readiness gate for implementation.', capabilities: ['prd-creation', 'story-writing', 'backlog-management', 'readiness-assessment'] }],
  ['ux-designer', { name: 'ux-designer', display_name: 'Moe (UX Designer)', description: 'UX researcher and designer. Creates wireframes, user flows, and UX specifications based on the PRD.', capabilities: ['ux-research', 'wireframing', 'user-flow-design', 'accessibility'] }],
  ['architect', { name: 'architect', display_name: 'Shemp (Architect)', description: 'Solutions architect. Designs system architecture, defines technical epics, and conducts code reviews during implementation.', capabilities: ['architecture-design', 'epic-definition', 'code-review', 'technical-oversight'] }],
  ['scrum-master', { name: 'scrum-master', display_name: 'Bob (Scrum Master)', description: 'Certified scrum master with technical background. Servant leader who orchestrates the implementation phase \u2014 sprint planning, story preparation, and retrospectives.', capabilities: ['sprint-planning', 'story-preparation', 'agile-ceremonies', 'team-coordination', 'retrospectives'] }],
  ['developer', { name: 'developer', display_name: 'Amelia (Developer)', description: 'Senior software engineer. Strict story adherence, test-driven development, team standards compliance. Ultra-succinct \u2014 speaks in file paths and acceptance criteria IDs.', capabilities: ['full-stack-development', 'test-driven-development', 'code-quality', 'story-implementation'] }],
  ['qa', { name: 'qa', display_name: 'Fiona (QA)', description: 'Quality assurance engineer. Writes and runs automated tests, performs integration testing, and validates acceptance criteria.', capabilities: ['test-automation', 'integration-testing', 'acceptance-validation', 'bug-reporting'] }],
  ['tech-writer', { name: 'tech-writer', display_name: 'Eve (Tech Writer)', description: 'Technical writer. Maintains API docs, user guides, and changelogs. Updates documentation after each sprint.', capabilities: ['api-documentation', 'user-guides', 'changelog-maintenance'] }],
  ['quick-flow-dev', { name: 'quick-flow-dev', display_name: 'Quick Flow Dev', description: 'Fast-track developer for small changes. Handles quick specs, rapid development, and self-reviews. Operates in parallel with the main flow.', capabilities: ['rapid-development', 'quick-spec', 'self-review'] }],
]);

export const BUNDLED_TEMPLATES: Record<string, BundledTemplate> = {
  'get-shit-done': { manifest: gsdManifest, roles: gsdRoles },
  'bmad-method': { manifest: bmadManifest, roles: bmadRoles },
};
