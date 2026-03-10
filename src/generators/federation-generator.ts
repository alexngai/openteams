import type { ResolvedFederation, FederationBridge, ResolvedTemplate } from "../template/types";

export interface FederationSkillOptions {
  /** Whether to include team boundary contracts (exports/imports). Defaults to true. */
  includeBoundaries?: boolean;
  /** Whether to include bridge definitions. Defaults to true. */
  includeBridges?: boolean;
}

/**
 * Generate a federated skill document showing how multiple teams compose.
 *
 * Produces a markdown overview of the federation: teams, their boundaries
 * (exports/imports), and bridges (cross-team signal routing).
 */
export function generateFederatedSkillMd(
  federation: ResolvedFederation,
  options: FederationSkillOptions = {}
): string {
  const includeBoundaries = options.includeBoundaries ?? true;
  const includeBridges = options.includeBridges ?? true;
  const m = federation.manifest;

  const sections: string[] = [];

  // Header
  sections.push(`# Federation: ${m.name}`);

  if (m.enforcement) {
    sections.push(`\nEnforcement: **${m.enforcement}**`);
  }

  // Teams overview
  sections.push(generateTeamsSection(federation));

  // Boundaries
  if (includeBoundaries) {
    sections.push(generateBoundariesSection(federation));
  }

  // Bridges
  if (includeBridges && federation.bridges.length > 0) {
    sections.push(generateBridgesSection(federation.bridges));
  }

  // Signal flow diagram (text)
  if (federation.bridges.length > 0) {
    sections.push(generateFlowSection(federation));
  }

  return sections.join("\n\n") + "\n";
}

/**
 * Generate bridge context for a specific team's agent prompts.
 *
 * Produces a markdown section describing which signals this team
 * sends to and receives from other teams via bridges.
 */
export function generateBridgeContext(
  federation: ResolvedFederation,
  teamKey: string
): string {
  const inbound = federation.bridges.filter((b) => b.to.team === teamKey);
  const outbound = federation.bridges.filter((b) => b.from.team === teamKey);

  if (inbound.length === 0 && outbound.length === 0) {
    return "";
  }

  const lines: string[] = ["## Cross-Team Signals"];

  if (inbound.length > 0) {
    lines.push("");
    lines.push("This team receives signals from external teams:");
    for (const bridge of inbound) {
      lines.push(
        `- **${bridge.to.signal}** on channel \`${bridge.to.channel}\` — from the ${bridge.from.team} team (signal: ${bridge.from.signal})`
      );
    }
  }

  if (outbound.length > 0) {
    lines.push("");
    lines.push("This team exports signals to other teams:");
    for (const bridge of outbound) {
      lines.push(
        `- **${bridge.from.signal}** — consumed by the ${bridge.to.team} team (channel: ${bridge.to.channel})`
      );
    }
  }

  return lines.join("\n");
}

// ─── Internal ────────────────────────────────────────────────

function generateTeamsSection(federation: ResolvedFederation): string {
  const lines: string[] = ["## Teams"];
  lines.push("");
  lines.push("| Team | Template | Roles | Zone |");
  lines.push("|------|----------|-------|------|");

  for (const [key, template] of federation.teams) {
    const entry = federation.manifest.teams[key];
    const roleCount = template.manifest.roles.length;
    const zone = entry.placement?.zone ?? "-";
    lines.push(`| ${key} | ${template.manifest.name} | ${roleCount} | ${zone} |`);
  }

  return lines.join("\n");
}

function generateBoundariesSection(federation: ResolvedFederation): string {
  const lines: string[] = ["## Team Boundaries"];

  for (const [key, template] of federation.teams) {
    const comm = template.manifest.communication;
    const exports = comm?.exports ?? [];
    const imports = comm?.imports ?? [];

    if (exports.length === 0 && imports.length === 0) continue;

    lines.push("");
    lines.push(`### ${key}`);

    if (exports.length > 0) {
      lines.push("");
      lines.push("**Exports:**");
      for (const exp of exports) {
        const desc = exp.description ? ` — ${exp.description}` : "";
        lines.push(`- \`${exp.signal}\`${desc}`);
      }
    }

    if (imports.length > 0) {
      lines.push("");
      lines.push("**Imports:**");
      for (const imp of imports) {
        const desc = imp.description ? ` — ${imp.description}` : "";
        lines.push(`- channel \`${imp.channel}\` [${imp.signals.join(", ")}]${desc}`);
      }
    }
  }

  return lines.join("\n");
}

function generateBridgesSection(bridges: FederationBridge[]): string {
  const lines: string[] = ["## Bridges"];
  lines.push("");
  lines.push("| From Team | Signal | To Team | Channel | Mapped Signal |");
  lines.push("|-----------|--------|---------|---------|---------------|");

  for (const bridge of bridges) {
    lines.push(
      `| ${bridge.from.team} | ${bridge.from.signal} | ${bridge.to.team} | ${bridge.to.channel} | ${bridge.to.signal} |`
    );
  }

  return lines.join("\n");
}

function generateFlowSection(federation: ResolvedFederation): string {
  const lines: string[] = ["## Signal Flow"];
  lines.push("");

  // Group bridges by source team for readability
  const bySource = new Map<string, FederationBridge[]>();
  for (const bridge of federation.bridges) {
    const existing = bySource.get(bridge.from.team) ?? [];
    existing.push(bridge);
    bySource.set(bridge.from.team, existing);
  }

  lines.push("```");
  for (const [source, bridges] of bySource) {
    for (const bridge of bridges) {
      const signalMap =
        bridge.from.signal === bridge.to.signal
          ? bridge.from.signal
          : `${bridge.from.signal} → ${bridge.to.signal}`;
      lines.push(
        `${source} --[${signalMap}]--> ${bridge.to.team} (${bridge.to.channel})`
      );
    }
  }
  lines.push("```");

  return lines.join("\n");
}
