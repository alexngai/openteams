import type {
  AgentSpawner,
  AgentInstance,
  AgentUpdate,
  SpawnAgentOptions,
} from "../types";

export class ACPFactorySpawner implements AgentSpawner {
  private agents: Map<string, AgentInstance> = new Map();
  private AgentFactoryModule: any = null;

  private async loadFactory(): Promise<any> {
    if (!this.AgentFactoryModule) {
      try {
        const mod = await import("acp-factory");
        this.AgentFactoryModule = mod.AgentFactory ?? mod.default?.AgentFactory ?? mod;
      } catch {
        throw new Error(
          "acp-factory is not installed. Install it with: npm install acp-factory"
        );
      }
    }
    return this.AgentFactoryModule;
  }

  async spawn(options: SpawnAgentOptions): Promise<AgentInstance> {
    const Factory = await this.loadFactory();

    const agentProvider = options.model ?? "claude-code";
    const handle = await Factory.spawn(agentProvider, {
      permissionMode: options.permissionMode ?? "auto-approve",
      agentType: options.agentType,
      env: options.env,
    });

    const session = await handle.createSession(options.cwd ?? process.cwd());

    const id = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let running = true;

    const instance: AgentInstance = {
      id,
      name: options.name,

      isRunning(): boolean {
        return running;
      },

      async *sendPrompt(prompt: string): AsyncIterable<AgentUpdate> {
        try {
          running = true;
          for await (const update of session.prompt(prompt)) {
            if (
              update.sessionUpdate === "agent_message_chunk" &&
              update.content?.type === "text"
            ) {
              yield { type: "text", content: update.content.text };
            } else if (update.sessionUpdate === "tool_call") {
              yield {
                type: "tool_call",
                content: update.toolName ?? "unknown tool",
              };
            } else if (update.sessionUpdate === "agent_thought_chunk") {
              yield { type: "thought", content: update.content?.text ?? "" };
            }
          }
          yield { type: "done", content: "" };
        } catch (err: any) {
          yield { type: "error", content: err.message ?? String(err) };
        } finally {
          running = false;
        }
      },

      async shutdown(): Promise<void> {
        running = false;
        await handle.close();
      },
    };

    this.agents.set(id, instance);
    return instance;
  }

  async shutdown(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.shutdown();
      this.agents.delete(agentId);
    }
  }

  list(): AgentInstance[] {
    return Array.from(this.agents.values());
  }
}
