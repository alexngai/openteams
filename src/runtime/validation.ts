import type { ResolvedTemplate, CommunicationConfig } from "../template/types";
import type { ValidationResult, Violation, ViolationSeverity } from "./types";

/**
 * Validate a message between two roles against the template's communication config.
 *
 * Stateless — takes the template and message parameters, returns a result.
 * Does not modify any state.
 */
export function validateMessage(
  template: ResolvedTemplate,
  fromRole: string,
  toRole: string,
  channel?: string,
  signal?: string
): ValidationResult {
  const violations: Violation[] = [];
  const comm = template.manifest.communication;
  const severity = enforcementSeverity(comm);

  // Check roles exist
  const validRoles = new Set(template.manifest.roles);
  if (!validRoles.has(fromRole)) {
    violations.push({ message: `Sender role "${fromRole}" not found in template`, severity: "error" });
  }
  if (!validRoles.has(toRole)) {
    violations.push({ message: `Receiver role "${toRole}" not found in template`, severity: "error" });
  }
  if (violations.length > 0) {
    return { valid: false, violations };
  }

  // If no communication config, all messages are allowed
  if (!comm) {
    return { valid: true, violations: [] };
  }

  // Check routing
  if (comm.routing?.peers && comm.routing.peers.length > 0) {
    const hasRoute = hasValidRoute(template, fromRole, toRole);
    if (!hasRoute) {
      violations.push({
        message: `No peer route from "${fromRole}" to "${toRole}"`,
        severity,
      });
    }
  }

  // Check channel/signal if specified
  if (channel) {
    validateChannel(comm, fromRole, toRole, channel, signal, severity, violations);
  }

  return {
    valid: violations.every((v) => v.severity !== "error"),
    violations,
  };
}

/** Check if there is a valid route between two roles. */
function hasValidRoute(
  template: ResolvedTemplate,
  fromRole: string,
  toRole: string
): boolean {
  const routing = template.manifest.communication?.routing;
  if (!routing?.peers) return true;

  // Check explicit peer routes
  for (const peer of routing.peers) {
    if (peer.from === fromRole && peer.to === toRole) return true;
  }

  // Check root ↔ companion implicit routes (root can talk to any companion and vice versa)
  const rootRole = template.manifest.topology.root.role;
  const companionRoles = new Set(
    (template.manifest.topology.companions ?? []).map((c) => c.role)
  );

  if (fromRole === rootRole && companionRoles.has(toRole)) return true;
  if (toRole === rootRole && companionRoles.has(fromRole)) return true;

  return false;
}

/** Validate channel emission and subscription rights. */
function validateChannel(
  comm: CommunicationConfig,
  fromRole: string,
  toRole: string,
  channel: string,
  signal: string | undefined,
  severity: ViolationSeverity,
  violations: Violation[]
): void {
  const channelDef = comm.channels?.[channel];
  if (!channelDef) {
    violations.push({ message: `Channel "${channel}" not defined`, severity });
    return;
  }

  // Check signal exists in channel
  if (signal && !channelDef.signals.includes(signal)) {
    violations.push({
      message: `Signal "${signal}" not defined in channel "${channel}"`,
      severity,
    });
  }

  // Check sender has emission rights
  const senderEmissions = comm.emissions?.[fromRole];
  if (senderEmissions && !senderEmissions.includes(channel)) {
    violations.push({
      message: `Role "${fromRole}" cannot emit to channel "${channel}"`,
      severity,
    });
  }

  // Check receiver has subscription
  const receiverSubs = comm.subscriptions?.[toRole];
  if (receiverSubs) {
    const sub = receiverSubs.find((s) => s.channel === channel);
    if (!sub) {
      violations.push({
        message: `Role "${toRole}" is not subscribed to channel "${channel}"`,
        severity,
      });
    } else if (signal && sub.signals && !sub.signals.includes(signal)) {
      violations.push({
        message: `Role "${toRole}" is not subscribed to signal "${signal}" on channel "${channel}"`,
        severity,
      });
    }
  }
}

/** Map enforcement mode to violation severity. */
function enforcementSeverity(comm?: CommunicationConfig): ViolationSeverity {
  if (!comm?.enforcement) return "warning";
  switch (comm.enforcement) {
    case "strict":
      return "error";
    case "audit":
    case "permissive":
      return "warning";
  }
}
