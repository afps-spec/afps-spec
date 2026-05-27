// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 AFPS contributors

/**
 * Validates that every shipped example under `examples/` parses against the
 * schema for its declared `type`, and that its `$schema` pointer (when present)
 * matches the canonical v0 URL. Guards against examples drifting out of sync
 * with the spec/schemas.
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  agentManifestSchema,
  skillManifestSchema,
  mcpServerManifestSchema,
  integrationManifestSchema,
} from "../src/schemas.ts";

const schemaByType: Record<string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }> = {
  agent: agentManifestSchema,
  skill: skillManifestSchema,
  "mcp-server": mcpServerManifestSchema,
  integration: integrationManifestSchema,
};

const examplesDir = join(import.meta.dir, "../../../examples");

const exampleDirs = readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("shipped examples validate against their schema", () => {
  test("examples/ directory is present and non-empty", () => {
    expect(exampleDirs.length).toBeGreaterThan(0);
  });

  for (const dir of exampleDirs) {
    const manifestPath = join(examplesDir, dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    test(`${dir} validates against its declared type`, () => {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const schema = schemaByType[manifest.type];
      expect(schema).toBeDefined();
      const result = schema.safeParse(manifest);
      if (!result.success) {
        // Surface the failure for debuggability.
        expect(result).toMatchObject({ success: true });
      }
      expect(result.success).toBe(true);
    });

    test(`${dir} carries a canonical v0 $schema pointer`, () => {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      expect(manifest.$schema).toBe(
        `https://schemas.afps.dev/v0/${manifest.type}.schema.json`,
      );
    });
  }
});
