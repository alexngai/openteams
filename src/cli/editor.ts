/**
 * openteams editor — launch the visual team configuration editor.
 *
 * Serves pre-built editor assets using a zero-dependency static file server
 * (Node.js http module) and opens the browser automatically.
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { exec } from "child_process";
import { Command } from "commander";

const EDITOR_DIST = path.resolve(__dirname, "../../../editor/dist");

// ── MIME types for static file serving ────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// ── Browser launcher ──────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${url}"`);
}

// ── Template file serving endpoint ────────────────────────────────────

function serveTemplateFile(
  reqUrl: URL,
  res: http.ServerResponse
): boolean {
  if (reqUrl.pathname !== "/__ot-template") return false;

  const filePath = reqUrl.searchParams.get("path");
  if (filePath && fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/yaml" });
    res.end(fs.readFileSync(filePath, "utf-8"));
    return true;
  }
  res.writeHead(404);
  res.end("Template file not found");
  return true;
}

// ── Static file server ────────────────────────────────────────────────

function startStaticServer(opts: {
  port: number;
  templateDir: string | null;
}): http.Server {
  const { port, templateDir } = opts;

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);

    // Serve template YAML files from disk
    if (serveTemplateFile(reqUrl, res)) return;

    // Resolve requested path within editor/dist, preventing traversal
    const requestedPath = path.normalize(reqUrl.pathname);
    let filePath = path.join(EDITOR_DIST, requestedPath);

    if (!filePath.startsWith(EDITOR_DIST)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // SPA fallback: serve index.html for non-file routes
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(EDITOR_DIST, "index.html");
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    const templateQuery = templateDir
      ? `?templateDir=${encodeURIComponent(templateDir)}`
      : "";
    const editorUrl = `http://localhost:${port}${templateQuery}`;

    console.log(`\n  Visual editor: ${editorUrl}`);
    console.log("  Press Ctrl+C to stop.\n");

    openBrowser(editorUrl);
  });

  return server;
}

// ── Command registration ──────────────────────────────────────────────

export function createEditorCommand(): Command {
  const editor = new Command("editor")
    .description("Launch the visual team configuration editor")
    .option("-d, --dir <path>", "Template directory to load", process.cwd())
    .option("-p, --port <port>", "Port", "5173")
    .action(async (opts) => {
      try {
        const baseDir = path.resolve(opts.dir);

        const indexFile = path.join(EDITOR_DIST, "index.html");
        if (!fs.existsSync(indexFile)) {
          console.error("Error: Pre-built editor assets not found.");
          console.error(
            "Run `npm run build:editor` first, or install openteams with editor support."
          );
          process.exit(1);
        }

        // Detect team.yaml in the specified directory
        const teamYaml = path.join(baseDir, "team.yaml");
        const hasTemplate = fs.existsSync(teamYaml);

        console.log("Starting visual editor...");
        if (hasTemplate) {
          console.log(`  Template detected: ${teamYaml}`);
        }

        const server = startStaticServer({
          port: parseInt(opts.port, 10),
          templateDir: hasTemplate ? baseDir : null,
        });

        process.on("SIGINT", () => {
          server.close();
          process.exit(0);
        });

        process.on("SIGTERM", () => {
          server.close();
          process.exit(0);
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  return editor;
}
