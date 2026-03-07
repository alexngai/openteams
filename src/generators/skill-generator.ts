import type { ResolvedTemplate, ResolvedRole } from "../template/types";

export interface SkillGeneratorOptions {
  /** Team name override (defaults to manifest name) */
  teamName?: string;
  /** Whether to include CLI usage examples */
  includeCliExamples?: boolean;
  /** Whether to include YAML frontmatter */
  includeFrontmatter?: boolean;
  /** Whether to include the "Spawn Rules" section. Defaults to true. */
  includeSpawnRules?: boolean;
}

export interface CatalogOptions {
  /** Team name override (defaults to manifest name) */
  teamName?: string;
}

/**
 * Generates a SKILL.md from a ResolvedTemplate.
 *
 * The generated file encodes the team's topology, communication patterns,
 * and role relationships as human-readable instructions. In the naive loader,
 * this leaves all interaction enforcement to agent discretion — agents read
 * the SKILL.md and coordinate by convention, not by runtime enforcement.
 */
/**
 * Generates a lightweight catalog document for a team template.
 *
 * The catalog provides progressive disclosure — agents see role names
 * and one-line descriptions without loading full role context. This
 * keeps context budgets tight while enabling role discovery.
 */
export function generateCatalog(
  template: ResolvedTemplate,
  options: CatalogOptions = {}
): string {
  const teamName = options.teamName ?? template.manifest.name;
  const m = template.manifest;

  const lines: string[] = [];

  lines.push(`# Team: ${teamName}`);
  if (m.description) {
    lines.push("");
    lines.push(`> ${m.description}`);
  }

  lines.push("");
  lines.push("## Roles");
  lines.push("");
  lines.push("| Role | Description | Position |");
  lines.push("|------|-------------|----------|");

  for (const roleName of m.roles) {
    const role = template.roles.get(roleName);
    const desc =
      role?.description && role.description !== `Role: ${roleName}`
        ? role.description
        : "";

    let position: string;
    if (m.topology.root.role === roleName) {
      position = "root";
    } else if (m.topology.companions?.some((c) => c.role === roleName)) {
      position = "companion";
    } else {
      position = "spawned";
    }

    lines.push(`| ${roleName} | ${desc} | ${position} |`);
  }

  lines.push("");
  lines.push("## Loading a role");
  lines.push("");
  lines.push("To get full context for a role, read the role's SKILL.md:");
  for (const roleName of m.roles) {
    lines.push(`- \`roles/${roleName}/SKILL.md\``);
  }
  lines.push("");
  lines.push(
    `Or via CLI: \`openteams generate role-package <template-dir> --role <role-name>\``
  );

  return lines.join("\n") + "\n";
}

export function generateSkillMd(
  template: ResolvedTemplate,
  options: SkillGeneratorOptions = {}
): string {
  const teamName = options.teamName ?? template.manifest.name;
  const includeCliExamples = options.includeCliExamples ?? true;
  const includeFrontmatter = options.includeFrontmatter ?? false;
  const includeSpawnRules = options.includeSpawnRules ?? true;
  const m = template.manifest;

  const sections: string[] = [];

  // YAML frontmatter
  if (includeFrontmatter) {
    sections.push(generateFrontmatter(template, teamName));
  }

  // Header
  sections.push(`# Team: ${teamName}`);
  if (m.description) {
    sections.push(`\n> ${m.description}`);
  }

  // Team structure
  sections.push(generateStructureSection(template));

  // Roles
  sections.push(generateRolesSection(template));

  // Communication
  if (m.communication) {
    sections.push(generateCommunicationSection(template));
  }

  // Spawn rules
  if (includeSpawnRules && m.topology.spawn_rules) {
    sections.push(generateSpawnRulesSection(template));
  }

  // Interaction guidelines
  sections.push(generateGuidelinesSection(teamName, template, includeCliExamples, includeSpawnRules));

  return sections.join("\n\n") + "\n";
}

function generateStructureSection(template: ResolvedTemplate): string {
  const m = template.manifest;
  const lines: string[] = ["## Team Structure"];

  const rootRole = m.topology.root.role;
  const rootConfig = m.topology.root.config;
  const modelTag = rootConfig?.model ? ` (model: ${rootConfig.model})` : "";
  lines.push(`- **Root**: ${rootRole}${modelTag}`);

  if (m.topology.companions && m.topology.companions.length > 0) {
    const companions = m.topology.companions.map((c) => {
      const tag = c.config?.model ? ` (model: ${c.config.model})` : "";
      return `${c.role}${tag}`;
    });
    lines.push(`- **Companions**: ${companions.join(", ")}`);
  }

  lines.push(`- **Roles**: ${m.roles.join(", ")}`);

  return lines.join("\n");
}

function generateRolesSection(template: ResolvedTemplate): string {
  const lines: string[] = ["## Roles"];

  for (const roleName of template.manifest.roles) {
    const role = template.roles.get(roleName);
    lines.push("");
    lines.push(`### ${roleName}`);

    if (role) {
      if (role.description && role.description !== `Role: ${roleName}`) {
        lines.push(`${role.description}`);
      }
      if (role.extends) {
        lines.push(`- **Extends**: ${role.extends}`);
      }
      if (role.capabilities.length > 0) {
        lines.push(`- **Capabilities**: ${role.capabilities.join(", ")}`);
        if (role.capabilityConfig) {
          const configured = Object.entries(role.capabilityConfig)
            .filter(([, v]) => v != null)
            .map(([k]) => k);
          if (configured.length > 0) {
            lines.push(`- **Configured**: ${configured.join(", ")}`);
          }
        }
      }
    }

    // Prompt summary
    const rolePrompts = template.prompts.get(roleName);
    if (rolePrompts) {
      // Include a truncated first line as a hint
      const firstLine = rolePrompts.primary.split("\n").find((l) => l.trim().length > 0);
      if (firstLine) {
        const preview =
          firstLine.length > 100
            ? firstLine.slice(0, 100) + "..."
            : firstLine;
        lines.push(`- **Prompt**: ${preview}`);
      }
      if (rolePrompts.additional.length > 0) {
        const names = rolePrompts.additional.map((s) => s.name);
        lines.push(`- **Additional**: ${names.join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

function generateCommunicationSection(template: ResolvedTemplate): string {
  const comm = template.manifest.communication!;
  const lines: string[] = ["## Communication"];

  if (comm.enforcement) {
    lines.push(`\nEnforcement: **${comm.enforcement}**`);
  }

  // Channels
  if (comm.channels && Object.keys(comm.channels).length > 0) {
    lines.push("");
    lines.push("### Channels");
    lines.push("");
    lines.push("| Channel | Signals | Description |");
    lines.push("|---------|---------|-------------|");
    for (const [name, def] of Object.entries(comm.channels)) {
      const desc = def.description ?? "";
      lines.push(`| ${name} | ${def.signals.join(", ")} | ${desc} |`);
    }
  }

  // Subscriptions
  if (comm.subscriptions && Object.keys(comm.subscriptions).length > 0) {
    lines.push("");
    lines.push("### Subscriptions");
    lines.push("");
    lines.push("| Role | Channel | Signals |");
    lines.push("|------|---------|---------|");
    for (const [role, entries] of Object.entries(comm.subscriptions)) {
      for (const entry of entries) {
        const signals = entry.signals ? entry.signals.join(", ") : "all";
        lines.push(`| ${role} | ${entry.channel} | ${signals} |`);
      }
    }
  }

  // Emissions
  if (comm.emissions && Object.keys(comm.emissions).length > 0) {
    lines.push("");
    lines.push("### Emission Permissions");
    lines.push("");
    lines.push("| Role | Can Emit |");
    lines.push("|------|----------|");
    for (const [role, signals] of Object.entries(comm.emissions)) {
      lines.push(`| ${role} | ${signals.join(", ")} |`);
    }
  }

  // Routing / Peer routes
  if (comm.routing) {
    if (comm.routing.status) {
      lines.push("");
      lines.push(`### Status Routing: **${comm.routing.status}**`);
    }

    if (comm.routing.peers && comm.routing.peers.length > 0) {
      lines.push("");
      lines.push("### Peer Routes");
      lines.push("");
      lines.push("| From | To | Via | Signals |");
      lines.push("|------|----|-----|---------|");
      for (const peer of comm.routing.peers) {
        const signals = peer.signals ? peer.signals.join(", ") : "all";
        lines.push(`| ${peer.from} | ${peer.to} | ${peer.via} | ${signals} |`);
      }
    }
  }

  return lines.join("\n");
}

function formatSpawnTarget(entry: string | { role: string; max_instances?: number }): string {
  if (typeof entry === "string") return entry;
  const limit = entry.max_instances != null ? ` (max: ${entry.max_instances})` : "";
  return `${entry.role}${limit}`;
}

function generateSpawnRulesSection(template: ResolvedTemplate): string {
  const rules = template.manifest.topology.spawn_rules!;
  const lines: string[] = ["## Spawn Rules"];
  lines.push("");
  lines.push("| Role | Can Spawn |");
  lines.push("|------|-----------|");
  for (const [from, targets] of Object.entries(rules)) {
    const targetStr = targets.length > 0 ? targets.map(formatSpawnTarget).join(", ") : "(none)";
    lines.push(`| ${from} | ${targetStr} |`);
  }
  return lines.join("\n");
}

function generateGuidelinesSection(
  teamName: string,
  template: ResolvedTemplate,
  includeCliExamples: boolean,
  includeSpawnRules: boolean = true,
): string {
  const m = template.manifest;
  const lines: string[] = ["## Agent Interaction Guidelines"];
  lines.push("");
  lines.push(
    `You are a member of the **${teamName}** team. Your behavior should follow the communication patterns described above.`
  );

  lines.push("");
  lines.push("### General Principles");
  lines.push("- Check the task board regularly for new or updated tasks");
  lines.push("- Communicate status changes through the appropriate channels");
  if (includeSpawnRules) {
    lines.push("- Respect spawn rules — only spawn roles you are permitted to");
  }
  lines.push(
    "- When emitting signals, use the correct channel for the signal type"
  );
  lines.push("- Read messages addressed to you and respond promptly");

  if (m.communication?.enforcement === "strict") {
    lines.push("");
    lines.push(
      "**Enforcement: strict** — Only emit signals you are explicitly permitted to. Unauthorized emissions will be rejected."
    );
  } else if (m.communication?.enforcement === "audit") {
    lines.push("");
    lines.push(
      "**Enforcement: audit** — Communication violations are logged but not blocked. Follow the declared patterns."
    );
  }

  if (includeCliExamples) {
    lines.push("");
    lines.push("### CLI Commands");
    lines.push("");
    lines.push("```bash");
    lines.push("# Check tasks");
    lines.push(`openteams task list ${teamName}`);
    lines.push("");
    lines.push("# Claim a task");
    lines.push(
      `openteams task update ${teamName} <task-id> --owner <your-name> --status in_progress`
    );
    lines.push("");
    lines.push("# Complete a task");
    lines.push(
      `openteams task update ${teamName} <task-id> --status completed`
    );
    lines.push("");
    lines.push("# Send a message to a teammate");
    lines.push(
      `openteams message send ${teamName} --to <agent> --content "..." --summary "..."`
    );
    lines.push("");
    lines.push("# Broadcast to all teammates");
    lines.push(
      `openteams message broadcast ${teamName} --content "..." --summary "..."`
    );

    if (m.communication?.channels) {
      lines.push("");
      lines.push("# Emit a signal on a channel");
      lines.push(
        `openteams template emit ${teamName} -c <channel> -s <signal> --sender <your-role>`
      );
      lines.push("");
      lines.push("# Check events visible to your role");
      lines.push(
        `openteams template events ${teamName} --role <your-role>`
      );
    }

    lines.push("```");
  }

  return lines.join("\n");
}

function generateFrontmatter(
  template: ResolvedTemplate,
  teamName: string
): string {
  const m = template.manifest;
  const lines: string[] = ["---"];
  lines.push(`name: ${teamName}`);
  if (m.description) {
    lines.push(`description: ${m.description}`);
  }
  lines.push(`roles: [${m.roles.join(", ")}]`);
  lines.push(`root: ${m.topology.root.role}`);
  lines.push("---");
  return lines.join("\n");
}
