import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import yaml from "js-yaml";
import {
  TemplateInstallService,
  type DiscoveredTemplate,
  type InstallCallbacks,
} from "./template-install-service";

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openteams-test-"));
}

function writeMinimalTemplate(dir: string, name: string): void {
  const templateDir = path.join(dir, name);
  fs.mkdirSync(templateDir, { recursive: true });
  fs.mkdirSync(path.join(templateDir, "roles"), { recursive: true });
  fs.mkdirSync(path.join(templateDir, "prompts"), { recursive: true });

  // Minimal valid team.yaml
  const manifest = {
    name,
    description: `Test template ${name}`,
    version: 1,
    roles: ["lead"],
    topology: {
      root: { role: "lead" },
    },
  };
  fs.writeFileSync(
    path.join(templateDir, "team.yaml"),
    yaml.dump(manifest)
  );

  // Minimal role file
  const role = {
    display_name: "Lead",
    description: "The team lead",
  };
  fs.writeFileSync(
    path.join(templateDir, "roles", "lead.yaml"),
    yaml.dump(role)
  );

  // Minimal prompt file
  fs.writeFileSync(
    path.join(templateDir, "prompts", "lead.md"),
    "You are the lead."
  );
}

function writeRootTemplate(dir: string, name: string): void {
  // Template at the root of the directory (no subdirectory)
  const manifest = {
    name,
    description: `Root template ${name}`,
    version: 1,
    roles: ["lead"],
    topology: {
      root: { role: "lead" },
    },
  };
  fs.writeFileSync(path.join(dir, "team.yaml"), yaml.dump(manifest));
  fs.mkdirSync(path.join(dir, "roles"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "roles", "lead.yaml"),
    yaml.dump({ display_name: "Lead", description: "The lead" })
  );
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "prompts", "lead.md"), "You are the lead.");
}

describe("TemplateInstallService", () => {
  let service: TemplateInstallService;
  let tmpDirs: string[];

  beforeEach(() => {
    service = new TemplateInstallService();
    tmpDirs = [];
  });

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTmpDir(): string {
    const dir = createTmpDir();
    tmpDirs.push(dir);
    return dir;
  }

  // --- normalizeRepoUrl ---

  describe("normalizeRepoUrl", () => {
    it("expands GitHub shorthand to full URL", () => {
      expect(service.normalizeRepoUrl("owner/repo")).toBe(
        "https://github.com/owner/repo.git"
      );
    });

    it("passes through https URLs unchanged", () => {
      const url = "https://github.com/owner/repo.git";
      expect(service.normalizeRepoUrl(url)).toBe(url);
    });

    it("passes through SSH URLs unchanged", () => {
      const url = "git@github.com:owner/repo.git";
      expect(service.normalizeRepoUrl(url)).toBe(url);
    });

    it("passes through local paths unchanged", () => {
      expect(service.normalizeRepoUrl("/tmp/my-repo")).toBe("/tmp/my-repo");
      expect(service.normalizeRepoUrl("./my-repo")).toBe("./my-repo");
    });
  });

  // --- discoverTemplates ---

  describe("discoverTemplates", () => {
    it("finds multiple templates in subdirectories", () => {
      const repoDir = makeTmpDir();
      writeMinimalTemplate(repoDir, "alpha");
      writeMinimalTemplate(repoDir, "beta");

      const templates = service.discoverTemplates(repoDir);
      expect(templates).toHaveLength(2);

      const names = templates.map((t) => t.name).sort();
      expect(names).toEqual(["alpha", "beta"]);
    });

    it("finds a single template", () => {
      const repoDir = makeTmpDir();
      writeMinimalTemplate(repoDir, "solo");

      const templates = service.discoverTemplates(repoDir);
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe("solo");
      expect(templates[0].manifestName).toBe("solo");
      expect(templates[0].relativePath).toBe("solo");
    });

    it("finds template at repo root", () => {
      const repoDir = makeTmpDir();
      writeRootTemplate(repoDir, "root-team");

      const templates = service.discoverTemplates(repoDir);
      expect(templates).toHaveLength(1);
      expect(templates[0].relativePath).toBe(".");
      expect(templates[0].manifestName).toBe("root-team");
    });

    it("returns empty array when no templates found", () => {
      const repoDir = makeTmpDir();
      fs.writeFileSync(path.join(repoDir, "README.md"), "nothing here");

      const templates = service.discoverTemplates(repoDir);
      expect(templates).toHaveLength(0);
    });

    it("skips .git and node_modules directories", () => {
      const repoDir = makeTmpDir();
      writeMinimalTemplate(repoDir, "real");

      // Put a team.yaml inside .git and node_modules — should be ignored
      const gitDir = path.join(repoDir, ".git", "fake-template");
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(
        path.join(repoDir, ".git", "team.yaml"),
        yaml.dump({ name: "fake" })
      );

      const nmDir = path.join(repoDir, "node_modules", "some-pkg");
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(
        path.join(repoDir, "node_modules", "team.yaml"),
        yaml.dump({ name: "fake2" })
      );

      const templates = service.discoverTemplates(repoDir);
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe("real");
    });
  });

  // --- resolveInstallPath ---

  describe("resolveInstallPath", () => {
    it("uses explicit output when provided", () => {
      const result = service.resolveInstallPath("my-team", "/tmp/custom-dir");
      expect(result.path).toBe("/tmp/custom-dir");
      expect(result.isGlobal).toBe(false);
    });

    it("falls back to global when no .openteams found", () => {
      // Run from a temp dir with no .openteams above it
      const originalCwd = process.cwd();
      const tmpDir = makeTmpDir();
      process.chdir(tmpDir);

      try {
        const result = service.resolveInstallPath("my-team");
        expect(result.path).toBe(
          path.join(os.homedir(), ".openteams", "templates", "my-team")
        );
        expect(result.isGlobal).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("finds .openteams in parent directory", () => {
      const originalCwd = process.cwd();
      const tmpDir = fs.realpathSync(makeTmpDir());
      const openteamsDir = path.join(tmpDir, ".openteams");
      fs.mkdirSync(openteamsDir);
      const subDir = path.join(tmpDir, "nested", "deep");
      fs.mkdirSync(subDir, { recursive: true });
      process.chdir(subDir);

      try {
        const result = service.resolveInstallPath("my-team");
        expect(result.path).toBe(
          path.join(openteamsDir, "templates", "my-team")
        );
        expect(result.isGlobal).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // --- copyTemplate ---

  describe("copyTemplate", () => {
    it("copies all files and directories, skipping .git", () => {
      const src = makeTmpDir();
      const dest = makeTmpDir();
      const destTarget = path.join(dest, "output");

      // Create source structure
      fs.writeFileSync(path.join(src, "team.yaml"), "name: test");
      fs.mkdirSync(path.join(src, "roles"));
      fs.writeFileSync(path.join(src, "roles", "lead.yaml"), "role: lead");
      fs.mkdirSync(path.join(src, "prompts", "lead"), { recursive: true });
      fs.writeFileSync(
        path.join(src, "prompts", "lead", "ROLE.md"),
        "role prompt"
      );
      fs.mkdirSync(path.join(src, ".git"));
      fs.writeFileSync(path.join(src, ".git", "HEAD"), "ref: refs/heads/main");

      service.copyTemplate(src, destTarget);

      // Verify copied files
      expect(fs.existsSync(path.join(destTarget, "team.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(destTarget, "roles", "lead.yaml"))).toBe(
        true
      );
      expect(
        fs.existsSync(path.join(destTarget, "prompts", "lead", "ROLE.md"))
      ).toBe(true);

      // Verify .git was skipped
      expect(fs.existsSync(path.join(destTarget, ".git"))).toBe(false);

      // Verify content
      expect(
        fs.readFileSync(path.join(destTarget, "team.yaml"), "utf-8")
      ).toBe("name: test");
    });
  });

  // --- writeMetadata ---

  describe("writeMetadata", () => {
    it("writes .openteams-install.json with correct content", () => {
      const dir = makeTmpDir();
      const metadata = {
        sourceRepo: "https://github.com/owner/repo.git",
        templateName: "my-team",
        installedAt: "2026-02-24T00:00:00.000Z",
        version: 1,
      };

      service.writeMetadata(dir, metadata);

      const metaPath = path.join(dir, ".openteams-install.json");
      expect(fs.existsSync(metaPath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      expect(parsed).toEqual(metadata);
    });
  });

  // --- install (full flow) ---

  describe("install", () => {
    it("installs a template from a local git repo", () => {
      // Set up a local git repo as the source
      const sourceDir = makeTmpDir();
      writeMinimalTemplate(sourceDir, "test-team");

      // Initialize as a git repo so clone works
      const { execSync } = require("child_process");
      execSync("git init", { cwd: sourceDir, stdio: "pipe" });
      execSync("git add -A", { cwd: sourceDir, stdio: "pipe" });
      execSync('git -c user.name="Test" -c user.email="test@test.com" commit -m "init"', {
        cwd: sourceDir,
        stdio: "pipe",
      });

      const outputDir = makeTmpDir();
      const installTarget = path.join(outputDir, "installed");

      const callbacks: InstallCallbacks = {
        selectTemplate: async () => "test-team",
        confirmGlobalInstall: async () => true,
        onProgress: () => {},
      };

      return service
        .install(
          {
            repoUrl: sourceDir,
            templateName: "test-team",
            outputDir: installTarget,
          },
          callbacks
        )
        .then((result) => {
          expect(result.templateName).toBe("test-team");
          expect(result.installedPath).toBe(installTarget);
          expect(result.sourceRepo).toBe(sourceDir);

          // Verify files exist
          expect(
            fs.existsSync(path.join(installTarget, "team.yaml"))
          ).toBe(true);
          expect(
            fs.existsSync(path.join(installTarget, "roles", "lead.yaml"))
          ).toBe(true);

          // Verify metadata
          const meta = JSON.parse(
            fs.readFileSync(
              path.join(installTarget, ".openteams-install.json"),
              "utf-8"
            )
          );
          expect(meta.templateName).toBe("test-team");
          expect(meta.sourceRepo).toBe(sourceDir);
          expect(meta.version).toBe(1);
        });
    });

    it("prompts for selection when multiple templates exist", () => {
      const sourceDir = makeTmpDir();
      writeMinimalTemplate(sourceDir, "alpha");
      writeMinimalTemplate(sourceDir, "beta");

      const { execSync } = require("child_process");
      execSync("git init", { cwd: sourceDir, stdio: "pipe" });
      execSync("git add -A", { cwd: sourceDir, stdio: "pipe" });
      execSync('git -c user.name="Test" -c user.email="test@test.com" commit -m "init"', {
        cwd: sourceDir,
        stdio: "pipe",
      });

      const outputDir = makeTmpDir();
      const installTarget = path.join(outputDir, "installed");

      let selectCalled = false;
      const callbacks: InstallCallbacks = {
        selectTemplate: async (templates: DiscoveredTemplate[]) => {
          selectCalled = true;
          expect(templates).toHaveLength(2);
          return "beta";
        },
        confirmGlobalInstall: async () => true,
        onProgress: () => {},
      };

      return service
        .install({ repoUrl: sourceDir, outputDir: installTarget }, callbacks)
        .then((result) => {
          expect(selectCalled).toBe(true);
          expect(result.templateName).toBe("beta");
        });
    });

    it("throws when no templates found", async () => {
      const sourceDir = makeTmpDir();
      fs.writeFileSync(path.join(sourceDir, "README.md"), "empty");

      const { execSync } = require("child_process");
      execSync("git init", { cwd: sourceDir, stdio: "pipe" });
      execSync("git add -A", { cwd: sourceDir, stdio: "pipe" });
      execSync('git -c user.name="Test" -c user.email="test@test.com" commit -m "init"', {
        cwd: sourceDir,
        stdio: "pipe",
      });

      const callbacks: InstallCallbacks = {
        selectTemplate: async () => "",
        confirmGlobalInstall: async () => true,
        onProgress: () => {},
      };

      await expect(
        service.install(
          { repoUrl: sourceDir, outputDir: makeTmpDir() },
          callbacks
        )
      ).rejects.toThrow("No team templates found in repository");
    });

    it("throws when specified template name not found", async () => {
      const sourceDir = makeTmpDir();
      writeMinimalTemplate(sourceDir, "alpha");

      const { execSync } = require("child_process");
      execSync("git init", { cwd: sourceDir, stdio: "pipe" });
      execSync("git add -A", { cwd: sourceDir, stdio: "pipe" });
      execSync('git -c user.name="Test" -c user.email="test@test.com" commit -m "init"', {
        cwd: sourceDir,
        stdio: "pipe",
      });

      const callbacks: InstallCallbacks = {
        selectTemplate: async () => "",
        confirmGlobalInstall: async () => true,
        onProgress: () => {},
      };

      await expect(
        service.install(
          {
            repoUrl: sourceDir,
            templateName: "nonexistent",
            outputDir: makeTmpDir(),
          },
          callbacks
        )
      ).rejects.toThrow('Template "nonexistent" not found. Available: alpha');
    });
  });
});
