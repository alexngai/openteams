import { describe, it, expect } from "vitest";
import {
  isTemplateName,
  getBuiltinTemplateDir,
  listBuiltinTemplates,
} from "./builtins";

describe("builtins", () => {
  describe("isTemplateName", () => {
    it("returns true for bare names", () => {
      expect(isTemplateName("gsd")).toBe(true);
      expect(isTemplateName("bug-fix-pipeline")).toBe(true);
      expect(isTemplateName("bmad-method")).toBe(true);
    });

    it("returns false for paths with separators", () => {
      expect(isTemplateName("./gsd")).toBe(false);
      expect(isTemplateName("examples/gsd")).toBe(false);
      expect(isTemplateName("some\\path")).toBe(false);
    });

    it("returns false for dot-prefixed names", () => {
      expect(isTemplateName(".hidden")).toBe(false);
      expect(isTemplateName("..")).toBe(false);
    });

    it("returns false for tilde-prefixed names", () => {
      expect(isTemplateName("~/templates")).toBe(false);
    });

    it("returns false for absolute paths", () => {
      expect(isTemplateName("/usr/local/templates")).toBe(false);
    });
  });

  describe("getBuiltinTemplateDir", () => {
    it("resolves known built-in template", () => {
      const dir = getBuiltinTemplateDir("gsd");
      expect(dir).not.toBeNull();
      expect(dir!.endsWith("gsd")).toBe(true);
    });

    it("returns null for unknown name", () => {
      expect(getBuiltinTemplateDir("nonexistent-template")).toBeNull();
    });
  });

  describe("listBuiltinTemplates", () => {
    it("returns all example templates", () => {
      const templates = listBuiltinTemplates();
      expect(templates.length).toBeGreaterThanOrEqual(8);

      const names = templates.map((t) => t.name);
      expect(names).toContain("gsd");
      expect(names).toContain("bmad-method");
      expect(names).toContain("bug-fix-pipeline");
    });

    it("includes metadata for each template", () => {
      const templates = listBuiltinTemplates();
      const gsd = templates.find((t) => t.name === "gsd");
      expect(gsd).toBeDefined();
      expect(gsd!.manifestName).toBe("gsd");
      expect(gsd!.description).toBeTruthy();
      expect(gsd!.path).toContain("examples");
    });

    it("returns templates sorted by name", () => {
      const templates = listBuiltinTemplates();
      const names = templates.map((t) => t.name);
      expect(names).toEqual([...names].sort());
    });
  });
});
