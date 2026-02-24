import type { AgentSpawner } from "../types";

let currentSpawner: AgentSpawner | null = null;

/**
 * @deprecated Use dependency injection instead. Pass spawner instances directly
 * to services/commands that need them (e.g. `new AgentService(db, spawner)`).
 */
export function setSpawner(spawner: AgentSpawner): void {
  currentSpawner = spawner;
}

/**
 * @deprecated Use dependency injection instead. Pass spawner instances directly
 * to services/commands that need them (e.g. `new AgentService(db, spawner)`).
 */
export function getSpawner(): AgentSpawner {
  if (!currentSpawner) {
    throw new Error(
      "No agent spawner configured. Call setSpawner() or use dependency injection instead."
    );
  }
  return currentSpawner;
}

/**
 * @deprecated Use dependency injection instead.
 */
export function hasSpawner(): boolean {
  return currentSpawner !== null;
}
