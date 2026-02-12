import type {
  ResolvedTemplate,
  ResolvedRole,
  ResolvedPrompts,
  SubscriptionEntry,
  PeerRoute,
} from "../template/types";

export interface AgentPrompt {
  role: string;
  prompt: string;
}

export interface AgentPromptGeneratorOptions {
  /** Team name override */
  teamName?: string;
  /** Additional context to prepend to every agent prompt */
  preamble?: string;
}

export interface RoleSkillMd {
  role: string;
  content: string;
}

export interface RoleSkillMdOptions {
  /** Team name override */
  teamName?: string;
}

/**
 * Generates per-role agent prompts in Claude sub-agent Task tool format.
 *
 * Each prompt includes:
 * - The role identity and team context
 * - The role's prompt content (from prompts/*.md or inline)
 * - Communication subscriptions, emissions, and peer routes for that role
 * - Spawn permissions
 * - CLI commands tailored to the role
 *
 * These prompts are designed to be passed directly to the Task tool's
 * prompt parameter when spawning Claude sub-agents.
 */
export function generateAgentPrompts(
  template: ResolvedTemplate,
  options: AgentPromptGeneratorOptions = {}
): AgentPrompt[] {
  const teamName = options.teamName ?? template.manifest.name;
  return template.manifest.roles.map((roleName) =>
    generateSingleAgentPrompt(template, roleName, teamName, options.preamble)
  );
}

/**
 * Generate a prompt for a single role.
 */
export function generateAgentPrompt(
  template: ResolvedTemplate,
  roleName: string,
  options: AgentPromptGeneratorOptions = {}
): AgentPrompt {
  const teamName = options.teamName ?? template.manifest.name;
  return generateSingleAgentPrompt(
    template,
    roleName,
    teamName,
    options.preamble
  );
}

/**
 * Generate a standalone SKILL.md for a single role.
 *
 * Unlike generateAgentPrompt, this produces an agent-agnostic document
 * with YAML frontmatter and self-contained context. Designed to be
 * readable by any AI agent, not just Claude.
 */
export function generateRoleSkillMd(
  template: ResolvedTemplate,
  roleName: string,
  options: RoleSkillMdOptions = {}
): RoleSkillMd {
  const teamName = options.teamName ?? template.manifest.name;
  const m = template.manifest;
  const role = template.roles.get(roleName);
  const rolePrompts = template.prompts.get(roleName);

  const sections: string[] = [];

  // YAML frontmatter
  sections.push(generateRoleFrontmatter(template, roleName, teamName));

  // Identity header
  sections.push(`# Role: ${roleName}`);
  sections.push(
    `Member of the **${teamName}** team.`
  );

  // Position in topology
  if (m.topology.root.role === roleName) {
    sections.push("Position: **root** (team lead)");
  } else if (m.topology.companions?.some((c) => c.role === roleName)) {
    sections.push(`Position: **companion** to root (${m.topology.root.role})`);
  } else {
    sections.push("Position: **spawned** agent");
  }

  // Role description
  if (role?.description && role.description !== `Role: ${roleName}`) {
    sections.push(`## Description\n\n${role.description}`);
  }

  // Additional prompt sections (e.g. SOUL.md) come before instructions
  if (rolePrompts) {
    for (const section of rolePrompts.additional) {
      const heading = section.name.charAt(0).toUpperCase() + section.name.slice(1);
      sections.push(`## ${heading}\n\n${section.content.trim()}`);
    }
    sections.push(`## Instructions\n\n${rolePrompts.primary.trim()}`);
  }

  // Teammates
  const otherRoles = m.roles.filter((r) => r !== roleName);
  if (otherRoles.length > 0) {
    sections.push(`## Teammates\n\n${otherRoles.join(", ")}`);
  }

  // Communication — agent-agnostic
  if (m.communication) {
    sections.push(
      generateAgnosticCommunicationSection(template, roleName, teamName)
    );
  }

  // Spawn permissions
  sections.push(generateRoleSpawnSection(template, roleName));

  // CLI reference
  sections.push(generateRoleCliSection(roleName, teamName, template));

  return {
    role: roleName,
    content: sections.join("\n\n") + "\n",
  };
}

/**
 * Generate standalone SKILL.md files for all roles.
 */
export function generateAllRoleSkillMds(
  template: ResolvedTemplate,
  options: RoleSkillMdOptions = {}
): RoleSkillMd[] {
  return template.manifest.roles.map((roleName) =>
    generateRoleSkillMd(template, roleName, options)
  );
}

function generateRoleFrontmatter(
  template: ResolvedTemplate,
  roleName: string,
  teamName: string
): string {
  const m = template.manifest;
  const role = template.roles.get(roleName);

  let position: string;
  if (m.topology.root.role === roleName) {
    position = "root";
  } else if (m.topology.companions?.some((c) => c.role === roleName)) {
    position = "companion";
  } else {
    position = "spawned";
  }

  const lines: string[] = ["---"];
  lines.push(`name: ${teamName}/${roleName}`);

  const desc =
    role?.description && role.description !== `Role: ${roleName}`
      ? role.description
      : `${roleName} role in the ${teamName} team`;
  lines.push(`description: ${desc}`);

  lines.push(`role: ${roleName}`);
  lines.push(`team: ${teamName}`);
  lines.push(`position: ${position}`);

  // Communication summary
  const subs = m.communication?.subscriptions?.[roleName];
  if (subs && subs.length > 0) {
    const channels = subs.map((s) => s.channel);
    lines.push(`subscribes: [${channels.join(", ")}]`);
  }

  const emissions = m.communication?.emissions?.[roleName];
  if (emissions && emissions.length > 0) {
    lines.push(`emits: [${emissions.join(", ")}]`);
  }

  const spawnRules = m.topology.spawn_rules?.[roleName];
  if (spawnRules && spawnRules.length > 0) {
    lines.push(`can_spawn: [${spawnRules.join(", ")}]`);
  }

  lines.push("---");
  return lines.join("\n");
}

function generateAgnosticCommunicationSection(
  template: ResolvedTemplate,
  roleName: string,
  teamName: string
): string {
  const comm = template.manifest.communication!;
  const lines: string[] = ["## Communication"];

  // Subscriptions
  const subs = comm.subscriptions?.[roleName];
  if (subs && subs.length > 0) {
    lines.push("");
    lines.push("### Subscriptions");
    lines.push("");
    for (const sub of subs) {
      if (sub.signals && sub.signals.length > 0) {
        lines.push(`- **${sub.channel}**: ${sub.signals.join(", ")}`);
      } else {
        lines.push(`- **${sub.channel}**: all signals`);
      }
    }
  } else {
    lines.push("");
    lines.push("No channel subscriptions.");
  }

  // Emissions
  const emissions = comm.emissions?.[roleName];
  if (emissions && emissions.length > 0) {
    lines.push("");
    lines.push("### Can Emit");
    lines.push("");
    lines.push(emissions.join(", "));
  }

  // Peer routes
  const peers = comm.routing?.peers;
  if (peers && peers.length > 0) {
    const outgoing = peers.filter((p) => p.from === roleName);
    const incoming = peers.filter((p) => p.to === roleName);

    if (outgoing.length > 0) {
      lines.push("");
      lines.push("### Peer Routes (outgoing)");
      for (const route of outgoing) {
        const signals = route.signals ? route.signals.join(", ") : "any";
        lines.push(`- To **${route.to}** via ${route.via} (signals: ${signals})`);
      }
    }

    if (incoming.length > 0) {
      lines.push("");
      lines.push("### Peer Routes (incoming)");
      for (const route of incoming) {
        const signals = route.signals ? route.signals.join(", ") : "any";
        lines.push(`- From **${route.from}** via ${route.via} (signals: ${signals})`);
      }
    }
  }

  return lines.join("\n");
}

function generateSingleAgentPrompt(
  template: ResolvedTemplate,
  roleName: string,
  teamName: string,
  preamble?: string
): AgentPrompt {
  const m = template.manifest;
  const role = template.roles.get(roleName);
  const rolePrompts = template.prompts.get(roleName);

  const sections: string[] = [];

  // Identity header
  sections.push(`# Role: ${roleName}`);
  sections.push(
    `You are the **${role?.displayName ?? roleName}** in the **${teamName}** team.`
  );

  if (preamble) {
    sections.push(preamble);
  }

  // Role description
  if (role?.description && role.description !== `Role: ${roleName}`) {
    sections.push(`## Description\n\n${role.description}`);
  }

  // Additional prompt sections (e.g. SOUL.md) come before instructions
  if (rolePrompts) {
    for (const section of rolePrompts.additional) {
      const heading = section.name.charAt(0).toUpperCase() + section.name.slice(1);
      sections.push(`## ${heading}\n\n${section.content.trim()}`);
    }
    sections.push(`## Instructions\n\n${rolePrompts.primary.trim()}`);
  }

  // Team context
  sections.push(generateTeamContextSection(template, roleName, teamName));

  // Communication — what this role sees and can do
  if (m.communication) {
    sections.push(
      generateRoleCommunicationSection(template, roleName, teamName)
    );
  }

  // Spawn permissions
  sections.push(generateRoleSpawnSection(template, roleName));

  // CLI reference
  sections.push(generateRoleCliSection(roleName, teamName, template));

  return {
    role: roleName,
    prompt: sections.join("\n\n") + "\n",
  };
}

function generateTeamContextSection(
  template: ResolvedTemplate,
  roleName: string,
  teamName: string
): string {
  const m = template.manifest;
  const lines: string[] = ["## Team Context"];

  // Position in topology
  if (m.topology.root.role === roleName) {
    lines.push(
      `You are the **root agent** (team lead) of the ${teamName} team.`
    );
  } else {
    const isCompanion = m.topology.companions?.some(
      (c) => c.role === roleName
    );
    if (isCompanion) {
      lines.push(
        `You are a **companion agent** to the root (${m.topology.root.role}).`
      );
    } else {
      lines.push(
        `You are a **spawned agent** under the direction of the team.`
      );
    }
  }

  // Teammates
  const otherRoles = m.roles.filter((r) => r !== roleName);
  if (otherRoles.length > 0) {
    lines.push(`Your teammates: ${otherRoles.join(", ")}`);
  }

  return lines.join("\n");
}

function generateRoleCommunicationSection(
  template: ResolvedTemplate,
  roleName: string,
  teamName: string
): string {
  const comm = template.manifest.communication!;
  const lines: string[] = ["## Communication"];

  // Subscriptions for this role
  const subs = comm.subscriptions?.[roleName];
  if (subs && subs.length > 0) {
    lines.push("");
    lines.push("### You receive events from:");
    for (const sub of subs) {
      if (sub.signals && sub.signals.length > 0) {
        lines.push(`- **${sub.channel}**: ${sub.signals.join(", ")}`);
      } else {
        lines.push(`- **${sub.channel}**: all signals`);
      }
    }
    lines.push("");
    lines.push(
      "Check for new events with:"
    );
    lines.push(
      `\`openteams template events ${teamName} --role ${roleName}\``
    );
  } else {
    lines.push("");
    lines.push("You have no channel subscriptions.");
  }

  // Emissions for this role
  const emissions = comm.emissions?.[roleName];
  if (emissions && emissions.length > 0) {
    lines.push("");
    lines.push("### You can emit:");
    lines.push(`- ${emissions.join(", ")}`);
    lines.push("");
    lines.push("Emit via the appropriate channel:");

    // Map signals back to channels
    if (comm.channels) {
      for (const signal of emissions) {
        for (const [chName, chDef] of Object.entries(comm.channels)) {
          if (chDef.signals.includes(signal)) {
            lines.push(
              `- \`openteams template emit ${teamName} -c ${chName} -s ${signal} --sender ${roleName}\``
            );
            break;
          }
        }
      }
    }
  }

  // Peer routes involving this role
  const peers = comm.routing?.peers;
  if (peers && peers.length > 0) {
    const outgoing = peers.filter((p) => p.from === roleName);
    const incoming = peers.filter((p) => p.to === roleName);

    if (outgoing.length > 0) {
      lines.push("");
      lines.push("### Direct routes (outgoing):");
      for (const route of outgoing) {
        const signals = route.signals ? route.signals.join(", ") : "any";
        lines.push(
          `- To **${route.to}** via ${route.via} (signals: ${signals})`
        );
      }
    }

    if (incoming.length > 0) {
      lines.push("");
      lines.push("### Direct routes (incoming):");
      for (const route of incoming) {
        const signals = route.signals ? route.signals.join(", ") : "any";
        lines.push(
          `- From **${route.from}** via ${route.via} (signals: ${signals})`
        );
      }
    }
  }

  return lines.join("\n");
}

function generateRoleSpawnSection(
  template: ResolvedTemplate,
  roleName: string
): string {
  const rules = template.manifest.topology.spawn_rules;
  const lines: string[] = ["## Spawn Permissions"];

  if (!rules) {
    lines.push("No spawn rules defined — spawning is permissive.");
    return lines.join("\n");
  }

  const allowed = rules[roleName];
  if (!allowed) {
    lines.push("No spawn rules for your role — spawning is permissive.");
  } else if (allowed.length === 0) {
    lines.push("You **cannot** spawn other agents.");
  } else {
    lines.push(`You can spawn: **${allowed.join(", ")}**`);
  }

  return lines.join("\n");
}

function generateRoleCliSection(
  roleName: string,
  teamName: string,
  template: ResolvedTemplate
): string {
  const lines: string[] = ["## CLI Quick Reference"];
  lines.push("");
  lines.push("```bash");
  lines.push("# View your tasks");
  lines.push(`openteams task list ${teamName} --owner <your-agent-name>`);
  lines.push("");
  lines.push("# Claim a pending task");
  lines.push(
    `openteams task update ${teamName} <task-id> --owner <your-agent-name> --status in_progress`
  );
  lines.push("");
  lines.push("# Mark task complete");
  lines.push(
    `openteams task update ${teamName} <task-id> --status completed`
  );
  lines.push("");
  lines.push("# Check messages");
  lines.push(
    `openteams message list ${teamName} --agent <your-agent-name>`
  );
  lines.push("");
  lines.push("# Send a message");
  lines.push(
    `openteams message send ${teamName} --from <your-agent-name> --to <recipient> --content "..." --summary "..."`
  );

  if (template.manifest.communication?.channels) {
    lines.push("");
    lines.push("# Check events for your role");
    lines.push(
      `openteams template events ${teamName} --role ${roleName}`
    );
  }

  lines.push("```");
  return lines.join("\n");
}
