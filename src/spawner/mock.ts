import type {
  AgentSpawner,
  AgentInstance,
  AgentUpdate,
  SpawnAgentOptions,
} from "../types";

export class MockSpawner implements AgentSpawner {
  private agents: Map<string, AgentInstance> = new Map();
  public spawnCalls: SpawnAgentOptions[] = [];
  public shutdownCalls: string[] = [];

  async spawn(options: SpawnAgentOptions): Promise<AgentInstance> {
    this.spawnCalls.push(options);

    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let running = true;

    const instance: AgentInstance = {
      id,
      name: options.name,

      isRunning(): boolean {
        return running;
      },

      async *sendPrompt(prompt: string): AsyncIterable<AgentUpdate> {
        yield { type: "text", content: `[Mock response to: ${prompt}]` };
        yield { type: "done", content: "" };
      },

      async shutdown(): Promise<void> {
        running = false;
      },
    };

    this.agents.set(id, instance);
    return instance;
  }

  async shutdown(agentId: string): Promise<void> {
    this.shutdownCalls.push(agentId);
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.shutdown();
      this.agents.delete(agentId);
    }
  }

  list(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  reset(): void {
    this.agents.clear();
    this.spawnCalls = [];
    this.shutdownCalls = [];
  }
}
