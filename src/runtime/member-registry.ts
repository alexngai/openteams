import type { ResolvedTemplate, SpawnRuleEntry } from "../template/types";
import type { AgentIdentifier, MemberIdentity } from "./types";

/**
 * Bidirectional identity registry for team members.
 *
 * Maps between roles, labels, and runtime agent identifiers.
 * Validates registrations against the team template topology.
 */
export class MemberRegistry {
  private readonly byAgentIdMap = new Map<AgentIdentifier, MemberIdentity>();
  private readonly byLabelMap = new Map<string, MemberIdentity>();
  private readonly roleInstanceCounts = new Map<string, number>();
  private readonly validRoles: Set<string>;
  private readonly maxInstances: Map<string, number>;

  constructor(private readonly template: ResolvedTemplate) {
    this.validRoles = new Set(template.manifest.roles);
    this.maxInstances = buildMaxInstances(template);
  }

  /**
   * Register a new team member.
   *
   * @param role - Must exist in the template's role list.
   * @param label - Human-readable label. Auto-generated if not provided.
   * @param agentId - Runtime-specific identifier.
   * @returns The registered identity.
   * @throws If role is unknown, agentId is duplicate, or max instances exceeded.
   */
  register(role: string, agentId: AgentIdentifier, label?: string): MemberIdentity {
    if (!this.validRoles.has(role)) {
      throw new Error(`Unknown role "${role}". Valid roles: ${[...this.validRoles].join(", ")}`);
    }

    if (this.byAgentIdMap.has(agentId)) {
      throw new Error(`Agent ID "${agentId}" is already registered`);
    }

    const currentCount = this.roleInstanceCounts.get(role) ?? 0;
    const max = this.maxInstances.get(role);
    if (max !== undefined && currentCount >= max) {
      throw new Error(
        `Role "${role}" already has ${currentCount}/${max} instances (max_instances limit reached)`
      );
    }

    const resolvedLabel = label ?? this.generateLabel(role);
    if (this.byLabelMap.has(resolvedLabel)) {
      throw new Error(`Label "${resolvedLabel}" is already in use`);
    }

    const identity: MemberIdentity = { role, label: resolvedLabel, agentId };
    this.byAgentIdMap.set(agentId, identity);
    this.byLabelMap.set(resolvedLabel, identity);
    this.roleInstanceCounts.set(role, currentCount + 1);
    return identity;
  }

  /**
   * Unregister a member by agent ID.
   *
   * @returns The removed identity, or undefined if not found.
   */
  unregister(agentId: AgentIdentifier): MemberIdentity | undefined {
    const identity = this.byAgentIdMap.get(agentId);
    if (!identity) return undefined;

    this.byAgentIdMap.delete(agentId);
    this.byLabelMap.delete(identity.label);
    const count = this.roleInstanceCounts.get(identity.role) ?? 1;
    if (count <= 1) {
      this.roleInstanceCounts.delete(identity.role);
    } else {
      this.roleInstanceCounts.set(identity.role, count - 1);
    }
    return identity;
  }

  /** Look up a member by runtime agent ID. */
  byAgentId(agentId: AgentIdentifier): MemberIdentity | undefined {
    return this.byAgentIdMap.get(agentId);
  }

  /** Look up a member by label. */
  byLabel(label: string): MemberIdentity | undefined {
    return this.byLabelMap.get(label);
  }

  /** Get all members with a given role. */
  byRole(role: string): MemberIdentity[] {
    const result: MemberIdentity[] = [];
    for (const identity of this.byAgentIdMap.values()) {
      if (identity.role === role) result.push(identity);
    }
    return result;
  }

  /** Get all registered members. */
  all(): MemberIdentity[] {
    return [...this.byAgentIdMap.values()];
  }

  /** Check if an agent ID is registered. */
  has(agentId: AgentIdentifier): boolean {
    return this.byAgentIdMap.has(agentId);
  }

  /** Current instance count for a role. */
  instanceCount(role: string): number {
    return this.roleInstanceCounts.get(role) ?? 0;
  }

  /** Total number of registered members. */
  get size(): number {
    return this.byAgentIdMap.size;
  }

  private generateLabel(role: string): string {
    const count = this.roleInstanceCounts.get(role) ?? 0;
    // First instance: just the role name. Subsequent: role-N.
    if (count === 0 && !this.byLabelMap.has(role)) return role;
    let n = count + 1;
    while (this.byLabelMap.has(`${role}-${n}`)) n++;
    return `${role}-${n}`;
  }
}

/** Build a map of role → max_instances from spawn rules. */
function buildMaxInstances(template: ResolvedTemplate): Map<string, number> {
  const map = new Map<string, number>();
  const rules = template.manifest.topology.spawn_rules;
  if (!rules) return map;

  for (const entries of Object.values(rules)) {
    for (const entry of entries) {
      if (typeof entry === "object" && entry.max_instances !== undefined) {
        map.set(entry.role, entry.max_instances);
      }
    }
  }
  return map;
}
