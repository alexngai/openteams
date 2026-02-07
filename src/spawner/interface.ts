import type { AgentSpawner } from "../types";

let currentSpawner: AgentSpawner | null = null;

export function setSpawner(spawner: AgentSpawner): void {
  currentSpawner = spawner;
}

export function getSpawner(): AgentSpawner {
  if (!currentSpawner) {
    throw new Error(
      "No agent spawner configured. Call setSpawner() or use the default ACP factory spawner."
    );
  }
  return currentSpawner;
}

export function hasSpawner(): boolean {
  return currentSpawner !== null;
}
