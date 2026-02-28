import { execFile, ChildProcess } from "child_process";
import type {
  AgentSpawner,
  AgentInstance,
  AgentUpdate,
  SpawnAgentOptions,
} from "../types";

/**
 * Options for constructing a ClaudeCodeSpawner.
 */
export interface ClaudeCodeSpawnerOptions {
  /** Path to the claude CLI binary (default: "claude") */
  claudePath?: string;
  /** Default teammate display mode: "in-process" | "tmux" (default: "in-process") */
  teammateMode?: "in-process" | "tmux";
}

/**
 * AgentSpawner implementation that uses Claude Code's native agent teams feature.
 *
 * Instead of spawning agents through an external factory, this spawner launches
 * Claude Code teammate sessions via the `claude` CLI. Each teammate is a full
 * Claude Code instance with its own context window, coordinated through Claude
 * Code's built-in task list and mailbox system.
 *
 * Requires:
 * - `claude` CLI available in PATH (or configured via `claudePath`)
 * - `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the environment
 */
export class ClaudeCodeSpawner implements AgentSpawner {
  private agents: Map<string, AgentInstance> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private claudePath: string;
  private teammateMode: "in-process" | "tmux";

  constructor(options: ClaudeCodeSpawnerOptions = {}) {
    this.claudePath = options.claudePath ?? "claude";
    this.teammateMode = options.teammateMode ?? "in-process";
  }

  async spawn(options: SpawnAgentOptions): Promise<AgentInstance> {
    const id = `cc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let running = false;

    // Capture references for use inside closures
    const teammateMode = this.teammateMode;
    const execClaude = this.execClaude.bind(this);
    const processes = this.processes;

    const instance: AgentInstance = {
      id,
      name: options.name,

      isRunning(): boolean {
        return running;
      },

      async *sendPrompt(prompt: string): AsyncIterable<AgentUpdate> {
        try {
          running = true;

          const args = [
            "--print",
            "--output-format", "stream-json",
            "--teammate-mode", teammateMode,
          ];

          if (options.model) {
            args.push("--model", options.model);
          }

          if (options.permissionMode === "auto-approve") {
            args.push("--dangerously-skip-permissions");
          }

          args.push(prompt);

          const result = await execClaude(args, {
            cwd: options.cwd,
            env: {
              ...options.env,
              CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
            },
          });

          // Parse stream-json output line by line
          for (const line of result.split("\n")) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              if (event.type === "assistant" && event.subtype === "text") {
                yield { type: "text", content: event.text ?? "" };
              } else if (event.type === "tool_use") {
                yield { type: "tool_call", content: event.name ?? "unknown tool" };
              } else if (event.type === "result") {
                yield { type: "text", content: event.result ?? "" };
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
          yield { type: "done", content: "" };
        } catch (err: any) {
          yield { type: "error", content: err.message ?? String(err) };
        } finally {
          running = false;
        }
      },

      shutdown: async (): Promise<void> => {
        running = false;
        const proc = processes.get(id);
        if (proc && !proc.killed) {
          proc.kill("SIGTERM");
        }
        processes.delete(id);
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

  private execClaude(
    args: string[],
    options: { cwd?: string; env?: Record<string, string> }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...options.env,
      };

      const proc = execFile(
        this.claudePath,
        args,
        {
          cwd: options.cwd ?? process.cwd(),
          env,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`claude CLI failed: ${stderr || error.message}`));
          } else {
            resolve(stdout);
          }
        }
      );

      // Track process for cleanup
      const id = Array.from(this.agents.entries())
        .find(([, a]) => !this.processes.has(a.id))?.[0];
      if (id) {
        this.processes.set(id, proc);
      }
    });
  }
}
