/**
 * AFPS 0.1 Conformance Test Suite
 *
 * Validates that:
 * 1. Valid 0.1 manifests (agent/skill/mcp-server/integration) pass.
 * 2. Invalid manifests are correctly rejected.
 * 3. Spec constraints (§2–§7, §10) are enforced.
 * 4. camelCase fields are rejected / not treated as standard.
 */

import { describe, test, expect } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentManifestSchema,
  skillManifestSchema,
  mcpServerManifestSchema,
  integrationManifestSchema,
  integrationSource,
  packageTypeEnum,
} from "../src/schemas.ts";

type Parser = { safeParse: (v: unknown) => { success: boolean } };

function expectValid(schema: Parser, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Surface the error to make failures debuggable.
    expect(result).toMatchObject({ success: true });
  }
  expect(result.success).toBe(true);
}

function expectInvalid(schema: Parser, value: unknown) {
  expect(schema.safeParse(value).success).toBe(false);
}

// ─────────────────────────────────────────────
// Reusable valid fixtures
// ─────────────────────────────────────────────

const validAgent = {
  name: "@example/customer-intake",
  version: "1.2.0",
  type: "agent",
  schema_version: "0.1",
  display_name: "Customer Intake Assistant",
  author: "AFPS Examples",
  description: "Collects inbound requests and produces a structured summary.",
  keywords: ["workflow", "email", "support"],
  license: "MIT",
  repository: "https://example.com/afps/customer-intake",
  dependencies: {
    integrations: { "@example/gmail": "^1.0.0" },
    skills: { "@example/rewrite-tone": "^1.0.0" },
    mcp_servers: { "@example/fetch-json": "^1.0.0" },
  },
  integrations_configuration: {
    "@example/gmail": { scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
  },
  input: {
    schema: { type: "object", properties: { query: { type: "string" } } },
    ui_hints: { query: { placeholder: "label:inbox newer_than:7d" } },
    property_order: ["query"],
  },
  output: {
    schema: { type: "object", properties: { summary: { type: "string" } } },
  },
  timeout: 300,
  _meta: { "dev.afps/policy": { tier: "high" } },
};

const validSkill = {
  name: "@example/rewrite-tone",
  version: "1.0.0",
  type: "skill",
  display_name: "Rewrite Tone",
  description: "Rewrites text in a professional tone.",
};

const validMcpServer = {
  name: "@example/fetch-json",
  version: "1.0.0",
  type: "mcp-server",
  schema_version: "0.1",
  manifest_version: "0.3",
  display_name: "Fetch JSON",
  description: "Fetches JSON over HTTP.",
  author: { name: "AFPS Examples" },
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: { command: "node", args: ["server/index.js"] },
  },
  tools: [{ name: "fetch", description: "Fetch a URL" }],
};

const validIntegrationOauth2 = {
  name: "@example/gmail",
  version: "1.0.0",
  type: "integration",
  schema_version: "0.1",
  display_name: "Gmail",
  source: { kind: "local", server: { name: "@example/gmail-server", version: "^1.2.0" } },
  auths: {
    oauth: {
      type: "oauth2",
      issuer: "https://accounts.google.com",
      default_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      delivery: {
        http: {
          in: "header",
          name: "Authorization",
          prefix: "Bearer ",
          value: "{$credential.access_token}",
        },
      },
    },
  },
};

const validIntegrationApiKey = {
  name: "@example/zendesk",
  version: "1.0.0",
  type: "integration",
  schema_version: "0.1",
  display_name: "Zendesk",
  source: { kind: "none" },
  auths: {
    token: {
      type: "api_key",
      credentials: {
        schema: { type: "object", properties: { api_key: { type: "string" } }, required: ["api_key"] },
      },
      delivery: {
        http: {
          in: "header",
          name: "Authorization",
          prefix: "Basic ",
          value: "{$credential.email}/token:{$credential.api_key}",
          encoding: "base64",
        },
      },
    },
  },
};

// ─────────────────────────────────────────────
// §2.1 — Package types
// ─────────────────────────────────────────────

describe("package types (§2.1)", () => {
  test("the four 0.1 types are valid", () => {
    expectValid(agentManifestSchema, validAgent);
    expectValid(skillManifestSchema, validSkill);
    expectValid(mcpServerManifestSchema, validMcpServer);
    expectValid(integrationManifestSchema, validIntegrationOauth2);
  });

  test("packageTypeEnum accepts exactly the four 0.1 types", () => {
    for (const t of ["agent", "skill", "mcp-server", "integration"]) {
      expect(packageTypeEnum.safeParse(t).success).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────
// §2.2 — Package identity (scoped names)
// ─────────────────────────────────────────────

describe("scoped name validation (§2.2)", () => {
  const base = { version: "1.0.0", type: "skill" };

  test("valid scoped names", () => {
    expectValid(skillManifestSchema, { ...base, name: "@scope/name" });
    expectValid(skillManifestSchema, { ...base, name: "@my-org/my-skill" });
    expectValid(skillManifestSchema, { ...base, name: "@a/b" });
    expectValid(skillManifestSchema, { ...base, name: "@abc123/def456" });
  });

  test("rejects unscoped names", () => {
    expectInvalid(skillManifestSchema, { ...base, name: "my-skill" });
    expectInvalid(skillManifestSchema, { ...base, name: "name" });
  });

  test("rejects uppercase", () => {
    expectInvalid(skillManifestSchema, { ...base, name: "@Scope/name" });
    expectInvalid(skillManifestSchema, { ...base, name: "@scope/Name" });
  });

  test("rejects underscores", () => {
    expectInvalid(skillManifestSchema, { ...base, name: "@scope/my_skill" });
  });

  test("rejects leading/trailing hyphens", () => {
    expectInvalid(skillManifestSchema, { ...base, name: "@-scope/name" });
    expectInvalid(skillManifestSchema, { ...base, name: "@scope/-name" });
    expectInvalid(skillManifestSchema, { ...base, name: "@scope/name-" });
  });

  test("rejects empty scope or name", () => {
    expectInvalid(skillManifestSchema, { ...base, name: "@/name" });
    expectInvalid(skillManifestSchema, { ...base, name: "@scope/" });
  });
});

// ─────────────────────────────────────────────
// §2.3 — Versioning (semver)
// ─────────────────────────────────────────────

describe("versioning (§2.3)", () => {
  const base = { name: "@test/pkg", type: "skill" };

  test("valid semver versions", () => {
    expectValid(skillManifestSchema, { ...base, version: "1.0.0" });
    expectValid(skillManifestSchema, { ...base, version: "0.1.0" });
    expectValid(skillManifestSchema, { ...base, version: "10.20.30" });
  });

  test("rejects invalid semver versions", () => {
    expectInvalid(skillManifestSchema, { ...base, version: "not-a-version" });
    expectInvalid(skillManifestSchema, { ...base, version: "1.0" });
    expectInvalid(skillManifestSchema, { ...base, version: "1" });
  });

  test("rejects empty / missing version", () => {
    expectInvalid(skillManifestSchema, { ...base, version: "" });
    expectInvalid(skillManifestSchema, { ...base });
  });
});

// ─────────────────────────────────────────────
// §3.1 — Common manifest fields
// ─────────────────────────────────────────────

describe("common manifest fields (§3.1)", () => {
  test("missing name/version/type rejected", () => {
    expectInvalid(skillManifestSchema, { version: "1.0.0", type: "skill" });
    expectInvalid(skillManifestSchema, { name: "@test/pkg", type: "skill" });
    expectInvalid(skillManifestSchema, { name: "@test/pkg", version: "1.0.0" });
  });

  test("optional snake_case metadata fields accepted", () => {
    expectValid(skillManifestSchema, {
      name: "@test/pkg",
      version: "1.0.0",
      type: "skill",
      display_name: "My Skill",
      description: "A useful skill",
      keywords: ["ai", "tool"],
      license: "MIT",
      repository: "https://github.com/test/repo",
    });
  });

  test("camelCase fields are NOT standard — they round-trip as extra fields only", () => {
    // displayName (camelCase) is not the standard field, so the standard
    // display_name remains absent; the camelCase key is preserved as an extra.
    const manifest = {
      name: "@test/pkg",
      version: "1.0.0",
      type: "skill",
      displayName: "Legacy",
    };
    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(data.display_name).toBeUndefined();
      expect(data.displayName).toBe("Legacy");
    }
  });
});

// ─────────────────────────────────────────────
// §2.4 / §3.2 — schema_version
// ─────────────────────────────────────────────

describe("schema_version (§2.4, §3.2)", () => {
  const agentBase = {
    name: "@test/agent",
    version: "1.0.0",
    type: "agent",
    display_name: "Test",
    author: "test",
  };

  test("valid 0.x schema_version formats for agents", () => {
    expectValid(agentManifestSchema, { ...agentBase, schema_version: "0.1" });
    expectValid(agentManifestSchema, { ...agentBase, schema_version: "0.0" });
    expectValid(agentManifestSchema, { ...agentBase, schema_version: "0.99" });
  });

  test("schema_version is required for agents", () => {
    expectInvalid(agentManifestSchema, { ...agentBase });
  });

  test("omitted schema_version error carries the MAJOR.MINOR format hint", () => {
    const result = agentManifestSchema.safeParse({ ...agentBase });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join(".") === "schema_version");
    expect(issue).toBeDefined();
    // The bare Zod default would be "expected string, received undefined" with
    // no format guidance — assert the hint replaced it.
    expect(issue!.message).toContain("MAJOR.MINOR");
    expect(issue!.message).toContain("version");
  });

  test("schema_version field exposes a description in the generated JSON Schema", () => {
    const agentSchema = JSON.parse(
      readFileSync(join(import.meta.dir, "../v0/agent.schema.json"), "utf-8"),
    ) as { properties?: { schema_version?: { description?: string } } };
    expect(agentSchema.properties?.schema_version?.description).toContain("MAJOR.MINOR");
  });

  test("schema_version is optional for skills and integrations", () => {
    expectValid(skillManifestSchema, validSkill);
    expectValid(skillManifestSchema, { ...validSkill, schema_version: "0.1" });
    const intNoVer = { ...validIntegrationOauth2 };
    delete (intNoVer as Record<string, unknown>).schema_version;
    expectValid(integrationManifestSchema, intNoVer);
  });

  test("invalid schema_version formats rejected", () => {
    expectInvalid(agentManifestSchema, { ...agentBase, schema_version: "1.0" }); // wrong major
    expectInvalid(agentManifestSchema, { ...agentBase, schema_version: "2.0" }); // wrong major
    expectInvalid(agentManifestSchema, { ...agentBase, schema_version: "0.0.0" }); // has patch
    expectInvalid(agentManifestSchema, { ...agentBase, schema_version: "v0.1" }); // prefix
  });

  test("schema_version format enforced on skills too", () => {
    expectInvalid(skillManifestSchema, { ...validSkill, schema_version: "0.0.0" });
    expectInvalid(skillManifestSchema, { ...validSkill, schema_version: "1.0" });
  });
});

// ─────────────────────────────────────────────
// §3.2 — Agent-specific fields
// ─────────────────────────────────────────────

describe("agent manifest (§3.2)", () => {
  const base = {
    name: "@test/agent",
    version: "1.0.0",
    type: "agent",
    schema_version: "0.1",
    display_name: "Test Agent",
    author: "test",
  };

  test("minimal agent valid", () => {
    expectValid(agentManifestSchema, base);
  });

  test("author is required and non-empty", () => {
    const noAuthor = { ...base };
    delete (noAuthor as Record<string, unknown>).author;
    expectInvalid(agentManifestSchema, noAuthor);
    expectInvalid(agentManifestSchema, { ...base, author: "" });
  });

  test("display_name is required and non-empty", () => {
    const noName = { ...base };
    delete (noName as Record<string, unknown>).display_name;
    expectInvalid(agentManifestSchema, noName);
    expectInvalid(agentManifestSchema, { ...base, display_name: "" });
  });

  test("timeout optional, must be positive", () => {
    expectValid(agentManifestSchema, { ...base, timeout: 300 });
    expectInvalid(agentManifestSchema, { ...base, timeout: 0 });
    expectInvalid(agentManifestSchema, { ...base, timeout: -1 });
  });

  test("integrations_configuration keyed by declared integration id (§4.4)", () => {
    expectValid(agentManifestSchema, {
      ...base,
      dependencies: { integrations: { "@acme/gmail": "^1.0.0" } },
      integrations_configuration: {
        "@acme/gmail": { tools: ["list_messages"], scopes: ["a", "b"], auth_key: "oauth" },
      },
    });
    // Key must be a scoped name.
    expectInvalid(agentManifestSchema, {
      ...base,
      integrations_configuration: { "bad-name": { scopes: [] } },
    });
    // Key without a matching dependencies.integrations entry is rejected.
    expectInvalid(agentManifestSchema, {
      ...base,
      dependencies: { integrations: { "@acme/other": "^1.0.0" } },
      integrations_configuration: { "@acme/gmail": { tools: ["list_messages"] } },
    });
  });

  test('integrations_configuration.<id>.tools accepts the wildcard literal "*" (§4.4)', () => {
    expectValid(agentManifestSchema, {
      ...base,
      dependencies: { integrations: { "@acme/gmail": "^1.0.0" } },
      integrations_configuration: { "@acme/gmail": { tools: "*" } },
    });
    // Other string literals are rejected — only "*" is a valid non-array form.
    expectInvalid(agentManifestSchema, {
      ...base,
      dependencies: { integrations: { "@acme/gmail": "^1.0.0" } },
      integrations_configuration: { "@acme/gmail": { tools: "all" } },
    });
  });

  test("integrations_configuration.<id>.required is an optional boolean (§4.4)", () => {
    const withConfig = (config: Record<string, unknown>) => ({
      ...base,
      dependencies: { integrations: { "@acme/gmail": "^1.0.0" } },
      integrations_configuration: { "@acme/gmail": { tools: ["list_messages"], ...config } },
    });
    expectValid(agentManifestSchema, withConfig({ required: true }));
    expectValid(agentManifestSchema, withConfig({ required: false }));
    expectValid(agentManifestSchema, withConfig({}));
    expectInvalid(agentManifestSchema, withConfig({ required: "yes" }));
    expectInvalid(agentManifestSchema, withConfig({ required: 1 }));

    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(import.meta.dir, "../v0/agent.schema.json"), "utf8")));
    expect(validate(withConfig({ required: true }))).toBe(true);
    expect(validate(withConfig({ required: false }))).toBe(true);
    expect(validate(withConfig({}))).toBe(true);
    expect(validate(withConfig({ required: "yes" }))).toBe(false);
    expect(validate(withConfig({ required: 1 }))).toBe(false);
  });
});

// ─────────────────────────────────────────────
// §4 — Dependencies
// ─────────────────────────────────────────────

describe("dependencies (§4)", () => {
  const base = {
    name: "@test/agent",
    version: "1.0.0",
    type: "agent",
    schema_version: "0.1",
    display_name: "Test",
    author: "test",
  };

  test("valid dependency maps (skills/mcp_servers/integrations)", () => {
    expectValid(agentManifestSchema, {
      ...base,
      dependencies: {
        skills: { "@acme/rewrite": "^1.0.0" },
        mcp_servers: { "@acme/fetch": "~2.1.0" },
        integrations: { "@acme/gmail": ">=1.0.0" },
      },
    });
  });

  test("empty + partial + wildcard ranges valid", () => {
    expectValid(agentManifestSchema, { ...base, dependencies: {} });
    expectValid(agentManifestSchema, {
      ...base,
      dependencies: { integrations: { "@acme/gmail": "^1.0.0" } },
    });
    expectValid(agentManifestSchema, {
      ...base,
      dependencies: { skills: { "@acme/skill": "*" } },
    });
  });

  test("dependency keys must be scoped, values valid ranges", () => {
    expectInvalid(agentManifestSchema, {
      ...base,
      dependencies: { skills: { "bad-name": "^1.0.0" } },
    });
    expectInvalid(agentManifestSchema, {
      ...base,
      dependencies: { skills: { "@acme/skill": "not-a-range!!!" } },
    });
  });
});

// ─────────────────────────────────────────────
// §5 — Schema system (input/output)
// ─────────────────────────────────────────────

describe("schema system (§5)", () => {
  const base = {
    name: "@test/agent",
    version: "1.0.0",
    type: "agent",
    schema_version: "0.1",
    display_name: "Test",
    author: "test",
  };

  test("valid input schema with file_constraints / ui_hints / property_order", () => {
    expectValid(agentManifestSchema, {
      ...base,
      input: {
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            doc: {
              type: "array",
              items: { type: "string", format: "uri", contentMediaType: "application/octet-stream" },
              maxItems: 5,
            },
          },
          required: ["text"],
        },
        file_constraints: { doc: { accept: ".pdf,.docx", max_size: 10485760 } },
        ui_hints: { text: { placeholder: "Enter..." } },
        property_order: ["text", "doc"],
      },
    });
  });

  test("schema container MUST be type: object", () => {
    expectInvalid(agentManifestSchema, {
      ...base,
      input: { schema: { type: "array", properties: {} } },
    });
  });

  test("output wrapper works identically to input", () => {
    const block = { schema: { type: "object", properties: { result: { type: "string" } } } };
    expectValid(agentManifestSchema, { ...base, input: block });
    expectValid(agentManifestSchema, { ...base, output: block });
  });

  test("wrapper without schema child is rejected", () => {
    expectInvalid(agentManifestSchema, { ...base, input: {} });
    expectInvalid(agentManifestSchema, { ...base, output: {} });
  });

  // 0.3 removed the agent `config` wrapper (§3.2): an agent's parameters are
  // now declared in `input`. No normative migration clause was written, so the
  // only thing keeping already-published 0.2 packages validating is §3 —
  // unknown top-level fields are allowed by the validation model and SHOULD be
  // preserved, which `agentManifestObjectSchema` implements as a
  // `z.looseObject`. That tolerance is deliberate and load-bearing: switching
  // the agent manifest to a strict object would silently invalidate every 0.2
  // manifest in the wild. This test pins it.
  test("tolerates a legacy 0.2 `config` block as an unknown field", () => {
    expectValid(agentManifestSchema, {
      ...base,
      config: {
        schema: {
          type: "object",
          properties: { language: { type: "string", default: "fr" } },
        },
      },
    });
  });

  test("non-canonical camelCase wrapper keys are not standard metadata", () => {
    // fileConstraints/uiHints/propertyOrder are non-canonical camelCase
    // spellings. The schema wrapper is a strict object, so these unknown keys
    // are stripped — they are NOT silently accepted as the snake_case standard
    // fields.
    const manifest = {
      ...base,
      input: {
        schema: { type: "object", properties: { f: { type: "string" } } },
        fileConstraints: { f: { maxSize: 100 } },
        uiHints: { f: { placeholder: "x" } },
        propertyOrder: ["f"],
      },
    };
    const result = agentManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      const input = (result.data as Record<string, unknown>).input as Record<string, unknown>;
      // Standard snake_case keys never appear, and the camelCase keys are stripped.
      expect(input.file_constraints).toBeUndefined();
      expect(input.property_order).toBeUndefined();
      expect(input.ui_hints).toBeUndefined();
      expect(input.fileConstraints).toBeUndefined();
      expect(input.propertyOrder).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────
// §3.4 — MCP-server manifest
// ─────────────────────────────────────────────

describe("mcp-server manifest (§3.4)", () => {
  test("valid mcp-server with _meta contract", () => {
    expectValid(mcpServerManifestSchema, validMcpServer);
  });

  test("string author is also accepted (MCPB permits both)", () => {
    expectValid(mcpServerManifestSchema, { ...validMcpServer, author: "Jane Dev" });
  });

  test("MCPB baseline fields required (manifest_version, name, version, server)", () => {
    for (const k of ["manifest_version", "name", "version", "server"]) {
      const m = { ...validMcpServer };
      delete (m as Record<string, unknown>)[k];
      expectInvalid(mcpServerManifestSchema, m);
    }
  });

  test("server requires type + entry_point + mcp_config.command", () => {
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      server: { entry_point: "x.js", mcp_config: { command: "node" } },
    });
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      server: { type: "node", mcp_config: { command: "node" } },
    });
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      server: { type: "node", entry_point: "x.js", mcp_config: {} },
    });
  });

  test("server.type enum: node/python/binary/uv accepted, others rejected", () => {
    for (const t of ["node", "python", "binary"]) {
      expectValid(mcpServerManifestSchema, {
        ...validMcpServer,
        server: { ...validMcpServer.server, type: t },
      });
    }
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      server: { ...validMcpServer.server, type: "ruby" },
    });
  });

  test("user_config entry must be MCPB-typed (§3.4)", () => {
    expectValid(mcpServerManifestSchema, {
      ...validMcpServer,
      user_config: {
        api_key: { type: "string", title: "API key", sensitive: true },
      },
    });
    // missing/invalid type discriminant
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      user_config: { api_key: { title: "no type" } },
    });
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      user_config: { api_key: { type: "secret" } },
    });
  });

  test("uv server type requires manifest_version 0.4", () => {
    expectInvalid(mcpServerManifestSchema, {
      ...validMcpServer,
      manifest_version: "0.3",
      server: { ...validMcpServer.server, type: "uv" },
    });
    expectValid(mcpServerManifestSchema, {
      ...validMcpServer,
      manifest_version: "0.4",
      server: { ...validMcpServer.server, type: "uv" },
    });
  });

  test("manifest_version enforces MAJOR.MINOR format (§3.4 + Appendix A)", () => {
    // Recommended values accept
    expectValid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "0.3" });
    expectValid(mcpServerManifestSchema, {
      ...validMcpServer,
      manifest_version: "0.4",
      server: { ...validMcpServer.server, type: "uv" },
    });
    // Forward-compat: future MCPB versions still accepted (no hard enum)
    expectValid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "1.0" });
    expectValid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "12.34" });

    // Format rejections
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "abc" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "0.3.1" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "1" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, manifest_version: "v0.3" });
  });

  test("name MUST be a scoped name (§2.2)", () => {
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, name: "fetch-json" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, name: "@scope/Name" });
  });

  test("type MUST be mcp-server", () => {
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, type: "tool" });
    expectInvalid(mcpServerManifestSchema, { ...validMcpServer, type: "agent" });
  });

  test("unknown _meta keys do not cause failure (§10)", () => {
    expectValid(mcpServerManifestSchema, {
      ...validMcpServer,
      _meta: {
        "com.example/provenance": { source: "git" },
      },
    });
  });
});

// ─────────────────────────────────────────────
// §3.5 / §7.1 — Integration source
// ─────────────────────────────────────────────

describe("integration source (§7.1)", () => {
  test("local source references an mcp-server by scoped name + range", () => {
    expectValid(integrationManifestSchema, validIntegrationOauth2);
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "local", server: { name: "@x/y", version: "^1.0.0", vendored: true } },
    });
  });

  test("local source rejects unscoped server name / invalid range", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "local", server: { name: "bad", version: "^1.0.0" } },
    });
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "local", server: { name: "@x/y", version: "nope!!" } },
    });
  });

  test("remote source: url + transport enum", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "remote", remote: { url: "https://e.com/mcp", transport: "streamable-http" } },
    });
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "remote", remote: { url: "https://e.com/mcp", transport: "sse" } },
    });
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "remote", remote: { url: "https://e.com/mcp", transport: "ws" } },
    });
  });

  test("remote source url must be a URL (§7.1)", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "remote", remote: { url: "not a url", transport: "sse" } },
    });
  });

  test("none source: bare kind, no further fields (§7.1)", () => {
    expectValid(integrationManifestSchema, validIntegrationApiKey);
    expectValid(integrationManifestSchema, {
      ...validIntegrationApiKey,
      source: { kind: "none" },
    });
    // The former `api` source kind was removed; it is no longer valid.
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationApiKey,
      source: { kind: "api", api: {} },
    });
  });

  test("unknown source kind rejected", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      source: { kind: "container", server: { name: "@x/y", version: "^1.0.0" } },
    });
  });

  test("source is required", () => {
    const noSource = { ...validIntegrationOauth2 };
    delete (noSource as Record<string, unknown>).source;
    expectInvalid(integrationManifestSchema, noSource);
  });
});

// ─────────────────────────────────────────────
// §7.2 – §7.5 — Auth methods & credential schema
// ─────────────────────────────────────────────

/** Zod and the generated JSON Schema agree on an integration manifest. */
const integrationJsonSchema = new Ajv2020({ strict: false, validateFormats: false }).compile(
  JSON.parse(readFileSync(join(import.meta.dir, "../v0/integration.schema.json"), "utf8")),
);
function expectBoth(valid: boolean, value: unknown) {
  if (valid) expectValid(integrationManifestSchema, value);
  else expectInvalid(integrationManifestSchema, value);
  expect(integrationJsonSchema(value)).toBe(valid);
}

describe("unauthenticated integration (§7.2)", () => {
  const publicRemote = {
    name: "@test/public-docs",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.3",
    display_name: "Public docs",
    source: { kind: "remote", remote: { url: "https://docs.example.com/mcp", transport: "streamable-http" } },
  };

  test("a remote or local source may omit auths", () => {
    expectValid(integrationManifestSchema, publicRemote);
    expectValid(integrationManifestSchema, {
      ...publicRemote,
      source: { kind: "local", server: { name: "@x/y", version: "^1.0.0" } },
    });
  });

  test("an empty auths map is not the unauthenticated spelling", () => {
    expectInvalid(integrationManifestSchema, { ...publicRemote, auths: {} });
  });

  test("a none source cannot be unauthenticated", () => {
    expectInvalid(integrationManifestSchema, { ...publicRemote, source: { kind: "none" } });
  });

  test("a self-hosted public server keeps its connection variables", () => {
    expectValid(integrationManifestSchema, {
      ...publicRemote,
      source: { kind: "remote", remote: { url: "{$variable.base_url}/mcp", transport: "streamable-http" } },
      variables: {
        schema: { type: "object", properties: { base_url: { type: "string" } }, required: ["base_url"] },
      },
    });
  });

  test("allow_undeclared_tools needs no wildcard-usable auth", () => {
    expectValid(integrationManifestSchema, { ...publicRemote, allow_undeclared_tools: true, default_tools: "*" });
  });

  test("tools declare no required_scopes: there is no auth method to name (§7.8)", () => {
    expectBoth(true, { ...publicRemote, tools_policy: { read: {} } });
    expectBoth(false, { ...publicRemote, tools_policy: { read: { required_scopes: { oauth: ["private:read"] } } } });
  });

  test("the generated JSON Schema agrees with Zod", () => {
    expectBoth(true, publicRemote);
    expectBoth(false, { ...publicRemote, auths: {} });
    expectBoth(false, { ...publicRemote, source: { kind: "none" } });
  });
});

describe("no credential in source.remote.url (§7.1)", () => {
  // `source.remote.url` carries no `{$credential.<field>}` placeholder: only a
  // `{$variable.<name>}` template is a valid placeholder.
  const keyAuth = {
    type: "api_key",
    credentials: {
      schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    },
    delivery: { http: { in: "header", name: "X-Key", value: "{$credential.key}" } },
  };
  const remote = (url: string, extra: Record<string, unknown> = {}) => ({
    name: "@test/personal-server",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.3",
    display_name: "Personal server",
    source: { kind: "remote", remote: { url, transport: "streamable-http" } },
    auths: { url_key: keyAuth },
    ...extra,
  });
  const baseUrlVariable = {
    variables: {
      schema: { type: "object", properties: { base_url: { type: "string" } }, required: ["base_url"] },
    },
  };

  test("a {$credential.<field>} path segment is invalid under Zod and JSON Schema", () => {
    for (const url of [
      "https://mcp.example.com/{$credential.key}/mcp",
      "https://mcp.example.com:8443/s/{$credential.key}",
      "https://mcp.example.com/mcp?key={$credential.key}",
      "https://{$credential.key}.example.com/mcp",
      "{$credential.key}/mcp",
    ]) {
      expectBoth(false, remote(url));
    }
  });

  test("a credential segment is invalid inside a URL template (§7.12)", () => {
    expectBoth(false, remote("{$variable.base_url}/{$credential.key}/mcp", baseUrlVariable));
  });

  test("a {$variable.<name>} template is valid under Zod and JSON Schema (§7.12)", () => {
    expectBoth(true, remote("{$variable.base_url}/mcp", baseUrlVariable));
    expectBoth(true, remote("{$variable.base_url}/api/v4/mcp", baseUrlVariable));
    expectBoth(true, {
      ...remote("https://{$variable.tenant}.example.com/mcp"),
      variables: {
        schema: { type: "object", properties: { tenant: { type: "string" } }, required: ["tenant"] },
      },
    });
  });

  test("an unauthenticated integration cannot carry one either", () => {
    const { auths: _auths, ...unauthenticated } = remote("https://mcp.example.com/{$credential.key}/mcp");
    expectBoth(false, unauthenticated);
  });

  test("every auth method declares a delivery", () => {
    const { delivery: _delivery, ...noDelivery } = keyAuth;
    expectBoth(false, remote("https://mcp.example.com/mcp", { auths: { url_key: noDelivery } }));
    expectBoth(true, remote("https://mcp.example.com/mcp"));
  });
});

describe("integration auth methods (§7.2 – §7.5)", () => {
  const base = {
    name: "@test/integration",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.1",
    display_name: "Test",
    source: { kind: "none" },
  };

  function withAuth(auths: Record<string, unknown>) {
    return { ...base, auths };
  }

  test("auths, when present, must have at least one entry (§7.2)", () => {
    expectInvalid(integrationManifestSchema, withAuth({}));
  });

  test("a none source needs an auth method (§7.2)", () => {
    const noAuths = { ...base };
    delete (noAuths as Record<string, unknown>).auths;
    expectInvalid(integrationManifestSchema, noAuths);
  });

  test("delivery is required (§7.6)", () => {
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        key: {
          type: "api_key",
          credentials: { schema: { type: "object", properties: { k: { type: "string" } }, required: ["k"] } },
        },
      }),
    );
  });

  test("auth key must match ^[a-z][a-z0-9_]*$", () => {
    expectValid(
      integrationManifestSchema,
      withAuth({
        my_oauth2: {
          type: "oauth2",
          issuer: "https://e.com",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        "Bad-Key": {
          type: "oauth2",
          issuer: "https://e.com",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
  });

  test("invalid auth type rejected", () => {
    expectInvalid(
      integrationManifestSchema,
      withAuth({ a: { type: "oauth1", delivery: { env: { X: { value: "v" } } } } }),
    );
  });

  test("oauth2 requires issuer OR (authorization_endpoint + token_endpoint)", () => {
    // issuer only — ok
    expectValid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          issuer: "https://accounts.google.com",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
    // endpoints only — ok
    expectValid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          authorization_endpoint: "https://e.com/auth",
          token_endpoint: "https://e.com/token",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
    // neither — rejected
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
    // only authorization_endpoint (missing token_endpoint) — rejected
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          authorization_endpoint: "https://e.com/auth",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
  });

  test("oauth2 on a `remote` source MAY omit issuer AND endpoints (§7.3 discovery)", () => {
    const remoteAuth = {
      o: {
        type: "oauth2",
        default_scopes: ["read"],
        delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
      },
    };
    // remote source — endpoints discovered from source.remote.url at connect time
    expectValid(integrationManifestSchema, {
      ...base,
      source: { kind: "remote", remote: { url: "https://mcp.example.com/mcp", transport: "streamable-http" } },
      auths: remoteAuth,
    });
    // same auth on a non-remote source — still rejected (issuer/endpoints required)
    expectInvalid(integrationManifestSchema, {
      ...base,
      source: { kind: "none" },
      auths: remoteAuth,
    });
    // remote source MAY still pin issuer explicitly (override wins)
    expectValid(integrationManifestSchema, {
      ...base,
      source: { kind: "remote", remote: { url: "https://mcp.example.com/mcp", transport: "streamable-http" } },
      auths: {
        o: {
          type: "oauth2",
          issuer: "https://mcp.example.com",
          default_scopes: ["read"],
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      },
    });
  });

  test("oauth2 optional fields accepted (token_endpoint_auth_method, pkce, resource, scope_catalog)", () => {
    expectValid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          issuer: "https://e.com",
          token_endpoint_auth_method: "client_secret_basic",
          code_challenge_methods_supported: ["S256"],
          resource: "https://api.e.com",
          authorization_params: { access_type: "offline" },
          default_scopes: ["read"],
          scope_catalog: [{ value: "read", label: "Read", description: "Read access", implies: ["r"] }],
          identity_claims: { account_id: "$.sub", email: "$.email" },
          required_identity_claims: ["sub"],
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
  });

  test("token_endpoint_auth_method accepts RFC 7591 values, rejects unknown (§7.3)", () => {
    for (const m of [
      "client_secret_basic",
      "client_secret_post",
      "client_secret_jwt",
      "private_key_jwt",
      "tls_client_auth",
      "self_signed_tls_client_auth",
      "none",
    ]) {
      expectValid(
        integrationManifestSchema,
        withAuth({
          o: {
            type: "oauth2",
            issuer: "https://e.com",
            token_endpoint_auth_method: m,
            delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
          },
        }),
      );
    }
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        o: {
          type: "oauth2",
          issuer: "https://e.com",
          token_endpoint_auth_method: "made_up_method",
          delivery: { http: { in: "header", name: "Authorization", value: "{$credential.t}" } },
        },
      }),
    );
  });

  test("api_key/basic/mtls/custom require credentials.schema", () => {
    for (const type of ["api_key", "basic", "mtls", "custom"]) {
      // missing credentials → invalid
      const auth: Record<string, unknown> = {
        type,
        delivery: { env: { X: { value: "{$credential.api_key}" } } },
      };
      if (type === "custom") {
        auth.connect = { login: { request: { method: "POST", url: "https://e.com/login" } } };
      }
      expectInvalid(integrationManifestSchema, withAuth({ a: auth }));

      // with credentials.schema → valid
      expectValid(
        integrationManifestSchema,
        withAuth({
          a: {
            ...auth,
            credentials: { schema: { type: "object", properties: { api_key: { type: "string" } } } },
          },
        }),
      );
    }
  });

  test("credentials.schema must be a valid object schema", () => {
    expectInvalid(
      integrationManifestSchema,
      withAuth({
        a: {
          type: "api_key",
          credentials: { schema: { type: "array", properties: {} } },
          delivery: { env: { X: { value: "{$credential.k}" } } },
        },
      }),
    );
  });
});

// ─────────────────────────────────────────────
// §7.6 — Credential delivery
// ─────────────────────────────────────────────

describe("connection variables (§7.12)", () => {
  const variables = {
    schema: {
      type: "object",
      properties: {
        base_url: { type: "string", format: "uri", default: "https://forge.example.com" },
        tenant: { type: "string" },
      },
      required: ["base_url", "tenant"],
    },
  };
  const bearer = { http: { in: "header", name: "Authorization", prefix: "Bearer ", value: "{$credential.access_token}" } };
  const tokenAuth = {
    type: "api_key",
    credentials: { schema: { type: "object", properties: { token: { type: "string" } }, required: ["token"] } },
    delivery: { http: { in: "header", name: "Authorization", prefix: "Bearer ", value: "{$credential.token}" } },
    authorized_uris: ["{$variable.base_url}/**"],
  };
  const selfHosted = {
    name: "@test/forge",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.3",
    display_name: "Forge",
    source: { kind: "remote", remote: { url: "{$variable.base_url}/mcp", transport: "streamable-http" } },
    variables,
    auths: { oauth: { type: "oauth2", delivery: bearer, authorized_uris: ["{$variable.base_url}/**"] }, token: tokenAuth },
  };
  const withUrl = (url: string) => ({ ...selfHosted, source: { kind: "remote", remote: { url, transport: "streamable-http" } } });
  const hostForm = {
    ...withUrl("https://{$variable.tenant}.forge.example.com/mcp"),
    auths: { oauth: { type: "oauth2", delivery: bearer, authorized_uris: ["https://{$variable.tenant}.forge.example.com/**"] }, token: tokenAuth },
  };
  const withOauth = (oauth: Record<string, unknown>) => ({
    ...selfHosted,
    source: { kind: "none" },
    auths: { oauth: { type: "oauth2", delivery: bearer, ...oauth } },
  });
  const withConnect = (request: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ...selfHosted,
    source: { kind: "none" },
    auths: {
      session: {
        type: "custom",
        credentials: { schema: { type: "object", properties: { password: { type: "string" } }, required: ["password"] } },
        connect: { login: { request: { method: "POST", ...request }, outputs: { token: "$response.body#/token" } } },
        delivery: { http: { in: "header", name: "Authorization", prefix: "Bearer ", value: "{$credential.token}" } },
        ...extra,
      },
    },
  });

  test("URL form and host form templates over declared variables are valid", () => {
    expectValid(integrationManifestSchema, selfHosted);
    expectValid(integrationManifestSchema, withUrl("{$variable.base_url}"));
    expectValid(integrationManifestSchema, withUrl("{$variable.base_url}/api/v4/mcp/"));
    expectValid(integrationManifestSchema, hostForm);
  });

  test("literal URLs stay valid without any variables", () => {
    const literal = { ...withUrl("https://forge.example.com/mcp"), auths: { oauth: { type: "oauth2", delivery: bearer } } };
    delete (literal as Record<string, unknown>).variables;
    expectValid(integrationManifestSchema, literal);
  });

  test("a templated issuer leaves endpoints and resource to discovery (§7.3)", () => {
    expectValid(integrationManifestSchema, withOauth({ issuer: "{$variable.base_url}", authorized_uris: ["{$variable.base_url}/api/**"] }));
    for (const field of ["authorization_endpoint", "token_endpoint", "userinfo_endpoint"]) {
      expectInvalid(integrationManifestSchema, withOauth({ issuer: "{$variable.base_url}", [field]: "https://forge.example.com/oauth/x" }));
    }
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "{$variable.base_url}", resource: "https://forge.example.com/api" }));
  });

  test("only issuer is templated among oauth2 fields (§7.3)", () => {
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "{$variable.base_url}", token_endpoint: "{$variable.tenant}/token" }));
    expectInvalid(integrationManifestSchema, withOauth({ token_endpoint: "{$variable.base_url}/oauth/token" }));
    expectInvalid(integrationManifestSchema, withOauth({ resource: "{$variable.base_url}/api" }));
  });

  test("a templated remote url leaves oauth2 issuer, endpoints and resource to discovery (§7.3)", () => {
    for (const field of ["issuer", "token_endpoint", "resource"]) {
      expectInvalid(integrationManifestSchema, {
        ...selfHosted,
        auths: { oauth: { type: "oauth2", delivery: bearer, [field]: "https://forge.example.com/x" } },
      });
    }
  });

  test("an issued credential's authorized_uris reference only the variables choosing its upstream (§7.9)", () => {
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "https://accounts.example.com", authorized_uris: ["{$variable.base_url}/**"] }));
    expectInvalid(integrationManifestSchema, withConnect({ url: "https://forge.example.com/login" }, { authorized_uris: ["{$variable.base_url}/**"] }));
    expectInvalid(integrationManifestSchema, withConnect({ url: "{$variable.base_url}/login" }, { authorized_uris: ["{$variable.base_url}/**"] }));
    // An author-bounded or separately chosen issuer never sends its token to another user-named host.
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "https://{$variable.tenant}.okta.com", authorized_uris: ["{$variable.base_url}/**"] }));
    expectValid(integrationManifestSchema, withOauth({ issuer: "https://{$variable.tenant}.okta.com", authorized_uris: ["https://{$variable.tenant}.okta.com/**"] }));
    expectInvalid(integrationManifestSchema, withConnect({ url: "https://{$variable.tenant}.forge.example.com/login" }, { authorized_uris: ["{$variable.base_url}/**"] }));
    expectInvalid(integrationManifestSchema, { ...hostForm, auths: { oauth: { ...hostForm.auths.oauth, authorized_uris: ["{$variable.base_url}/**"] } } });
    // A user-supplied credential is not issued by an upstream: any declared variable bounds it.
    expectValid(integrationManifestSchema, { ...hostForm, auths: { ...hostForm.auths, token: { ...tokenAuth, authorized_uris: ["{$variable.base_url}/**"] } } });
  });

  test("an entry carrying a variable takes the URL form or fills the host (§7.9)", () => {
    const withToken = (uri: string) => ({ ...selfHosted, auths: { token: { ...tokenAuth, authorized_uris: [uri] } } });
    expectValid(integrationManifestSchema, withToken("https://{$variable.tenant}/**"));
    expectValid(integrationManifestSchema, withToken("https://{$variable.tenant}.forge.example.com:8443/**"));
    for (const uri of [
      "https://forge.example.com:{$variable.tenant}/**",
      "https://{$variable.tenant}@evil.example/**",
      "https://x.example.com/{$variable.base_url}/**",
      "{$variable.base_url}{$variable.tenant}/**",
      "{$variable.base_url}/{$variable.tenant}/**",
      "https://{$variable.tenant}.{$credential.token}.example.com/**",
    ]) {
      expectInvalid(integrationManifestSchema, withToken(uri));
    }
  });

  test("an issued credential's entries share the origin of the template choosing its upstream (§7.9)", () => {
    // A host-form value may hold dots: a bare-host entry would reach `evil.com`, not `evil.com.forge.example.com`.
    expectInvalid(integrationManifestSchema, { ...hostForm, auths: { oauth: { ...hostForm.auths.oauth, authorized_uris: ["https://{$variable.tenant}/**"] } } });
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "https://{$variable.tenant}.auth.example.com", authorized_uris: ["https://{$variable.tenant}/**"] }));
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "https://{$variable.tenant}.auth.example.com", authorized_uris: ["https://{$variable.tenant}.api.example.com/**"] }));
    expectValid(integrationManifestSchema, withOauth({ issuer: "https://{$variable.tenant}.Auth.example.com", authorized_uris: ["https://{$variable.tenant}.auth.example.com/v1/**"] }));
    // A connect.tool credential is issued by the templated remote server.
    const toolAuth = {
      type: "custom",
      credentials: { schema: { type: "object", properties: { password: { type: "string" } }, required: ["password"] } },
      connect: { tool: {} },
      delivery: bearer,
    };
    expectValid(integrationManifestSchema, { ...selfHosted, auths: { session: { ...toolAuth, authorized_uris: ["{$variable.base_url}/**"] } } });
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { session: { ...toolAuth, authorized_uris: ["https://{$variable.tenant}/**"] } } });
  });

  test("a remote resource's tokens go to its own origin, not the issuer's (§7.9)", () => {
    const split = (entry: string) => ({
      ...withUrl("https://{$variable.tenant}.mcp.example.com/mcp"),
      auths: { oauth: { type: "oauth2", delivery: bearer, issuer: "https://{$variable.tenant}.auth.example.com", authorized_uris: [entry] } },
    });
    expectValid(integrationManifestSchema, split("https://{$variable.tenant}.mcp.example.com/**"));
    expectInvalid(integrationManifestSchema, split("https://{$variable.tenant}.auth.example.com/**"));
  });

  test("connect.tool on a fixed remote url gets no variable in authorized_uris (§7.9)", () => {
    const toolAuth = {
      type: "custom",
      credentials: { schema: { type: "object", properties: { password: { type: "string" } }, required: ["password"] } },
      connect: { tool: {} },
      delivery: bearer,
      authorized_uris: ["{$variable.base_url}/**"],
    };
    expectInvalid(integrationManifestSchema, { ...withUrl("https://forge.example.com/mcp"), auths: { session: toolAuth } });
  });

  test("an auth whose upstream is templated reaches no other origin (§7.9)", () => {
    const withUris = (uris: string[]) => ({ ...selfHosted, auths: { oauth: { ...selfHosted.auths.oauth, authorized_uris: uris } } });
    expectInvalid(integrationManifestSchema, withUris(["{$variable.base_url}/**", "https://exfil.example.com/**"]));
    expectInvalid(integrationManifestSchema, { ...hostForm, auths: { oauth: { ...hostForm.auths.oauth, authorized_uris: ["https://{$variable.tenant}.forge.example.com:443/**"] } } });
    // A fixed remote server with the customer's own IdP: tokens are for the fixed resource.
    const fixedRemote = (uris: string[]) => ({
      ...withUrl("https://mcp.example.com/mcp"),
      auths: { oauth: { type: "oauth2", delivery: bearer, issuer: "https://{$variable.tenant}.okta.com", authorized_uris: uris } },
    });
    expectValid(integrationManifestSchema, fixedRemote(["https://mcp.example.com/**"]));
    expectInvalid(integrationManifestSchema, fixedRemote(["https://{$variable.tenant}.okta.com/**"]));
  });

  test("a variable renders either as a URL or as host labels (§7.12)", () => {
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { oauth: { ...selfHosted.auths.oauth, issuer: "https://{$variable.base_url}.example.com" } } });
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { token: { ...tokenAuth, authorized_uris: ["https://{$variable.base_url}/**"] } } });
  });

  test("connect delivery values follow the credential's upstream (§7.12)", () => {
    const valueOf = (value: string) => ({ http: { in: "header", name: "Authorization", prefix: "Bearer ", value } });
    expectInvalid(integrationManifestSchema, withConnect({ url: "https://forge.example.com/login" }, { delivery: valueOf("{$variable.base_url}") }));
    const toolAuth = (value: string) => ({
      type: "custom",
      credentials: { schema: { type: "object", properties: { password: { type: "string" } }, required: ["password"] } },
      connect: { tool: {} },
      delivery: valueOf(value),
    });
    expectValid(integrationManifestSchema, { ...selfHosted, auths: { session: toolAuth("{$credential.token} {$variable.base_url}") } });
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { session: toolAuth("{$credential.token} {$variable.tenant}") } });
  });

  test("a templated remote url admits an issuer templated over its variables (§7.3)", () => {
    const withIssuer = (issuer: string) => ({ ...selfHosted, auths: { oauth: { ...selfHosted.auths.oauth, issuer } } });
    expectValid(integrationManifestSchema, withIssuer("{$variable.base_url}"));
    expectInvalid(integrationManifestSchema, withIssuer("https://{$variable.tenant}.auth.example.com"));
    expectInvalid(integrationManifestSchema, withIssuer("https://gitlab.com"));
  });

  test("connect.login.request carries no variable (§7.7)", () => {
    expectValid(integrationManifestSchema, withConnect({ url: "https://forge.example.com/login", body: "password={{password}}" }));
    expectInvalid(integrationManifestSchema, withConnect({ url: "{$variable.base_url}/login" }));
    expectInvalid(integrationManifestSchema, withConnect({ url: "https://forge.example.com/login", body: "host={$variable.base_url}" }));
  });

  test("no variable steers an issued credential through a value template (§7.12)", () => {
    const withEnv = (oauth: Record<string, unknown>) =>
      withOauth({ ...oauth, delivery: { env: { GITLAB_TOKEN: { value: "{$credential.access_token}" }, GITLAB_URL: { value: "{$variable.base_url}" } } } });
    expectInvalid(integrationManifestSchema, withEnv({ issuer: "https://gitlab.com" }));
    expectInvalid(integrationManifestSchema, withEnv({ issuer: "https://{$variable.tenant}.gitlab.example.com" }));
    expectValid(integrationManifestSchema, withEnv({ issuer: "{$variable.base_url}" }));
  });

  test("only credentials.schema is exempt from placement checks", () => {
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { token: { ...tokenAuth, credentials: { ...tokenAuth.credentials, hint: "{$variable.base_url}" } } } });
  });

  test("variables appear only where §7.12 allows them", () => {
    expectInvalid(integrationManifestSchema, withOauth({ issuer: "{$variable.base_url}", authorization_params: { host: "{$variable.base_url}" } }));
    expectInvalid(integrationManifestSchema, { ...selfHosted, setup_guide: { steps: [{ label: "Open", url: "{$variable.base_url}/settings" }] } });
    expectInvalid(integrationManifestSchema, { ...selfHosted, auths: { token: { ...tokenAuth, issuer: "{$variable.base_url}" } } });
    const withDelivery = (delivery: Record<string, unknown>) => ({ ...selfHosted, auths: { token: { ...tokenAuth, delivery } } });
    expectInvalid(integrationManifestSchema, withDelivery({ files: { "/etc/{$variable.tenant}.pem": { value: "{$credential.token}" } } }));
    expectInvalid(integrationManifestSchema, withDelivery({ env: { "{$variable.tenant}": { value: "{$credential.token}" } } }));
    expectInvalid(integrationManifestSchema, {
      ...selfHosted,
      source: { kind: "none", remote: { url: "{$variable.base_url}/mcp", transport: "streamable-http" } },
      auths: { token: tokenAuth },
    });
  });

  test("every reference names a declared variable", () => {
    const withToken = (token: Record<string, unknown>) => ({ ...selfHosted, auths: { token: { ...tokenAuth, ...token } } });
    expectInvalid(integrationManifestSchema, withUrl("{$variable.host_url}/mcp"));
    expectInvalid(integrationManifestSchema, withToken({ authorized_uris: ["{$variable.nope}/**"] }));
    expectInvalid(integrationManifestSchema, withToken({ delivery: { http: { in: "header", name: "X-Tenant", value: "{$variable.nope}" } } }));
    expectInvalid(integrationManifestSchema, withToken({ delivery: { http: { in: "header", name: "X-Tenant", value: "{$variable.Base_url}" } } }));
    expectInvalid(integrationManifestSchema, withToken({ authorized_uris: ["{$variable.BASE}/**"] }));
    expectValid(integrationManifestSchema, withToken({ delivery: { http: { in: "header", name: "X-Tenant", value: "{$variable.tenant}" } } }));
    expectValid(integrationManifestSchema, withToken({ delivery: { env: { FORGE_URL: { value: "{$variable.base_url}" } } } }));
    expectValid(integrationManifestSchema, withToken({ delivery: { files: { "/etc/forge/url": { value: "{$variable.base_url}" } } } }));
    expectInvalid(integrationManifestSchema, withToken({ delivery: { env: { FORGE_URL: { value: "{$variable.nope}" } } } }));
    const noVariables = { ...selfHosted };
    delete (noVariables as Record<string, unknown>).variables;
    expectInvalid(integrationManifestSchema, noVariables);
  });

  test("variables: at least one, each a required string named like auth keys", () => {
    expectInvalid(integrationManifestSchema, { ...selfHosted, variables: { schema: { ...variables.schema, required: ["tenant"] } } });
    expectInvalid(integrationManifestSchema, { ...selfHosted, variables: { schema: { ...variables.schema, required: ["base_url", "tenant", "region"] } } });
    expectInvalid(integrationManifestSchema, {
      ...selfHosted,
      variables: { schema: { ...variables.schema, properties: { ...variables.schema.properties, base_url: { type: "number" } } } },
    });
    const literal = withUrl("https://forge.example.com/mcp");
    const oauthOnly = { oauth: { type: "oauth2", delivery: bearer } };
    expectInvalid(integrationManifestSchema, { ...literal, auths: oauthOnly, variables: { schema: { type: "object", properties: { BaseUrl: { type: "string" } }, required: ["BaseUrl"] } } });
    expectInvalid(integrationManifestSchema, { ...literal, auths: oauthOnly, variables: { schema: { type: "object", properties: {} } } });
  });

  test("variables and credential fields are separate namespaces", () => {
    expectValid(integrationManifestSchema, {
      ...selfHosted,
      auths: {
        token: {
          ...tokenAuth,
          credentials: { schema: { type: "object", properties: { token: { type: "string" }, base_url: { type: "string" } } } },
        },
      },
    });
  });

  test("a URL template is strict", () => {
    for (const url of [
      "{$variable.base_url}?x=1",
      "{$variable.base_url}/mcp#f",
      "{$variable.base_url}/**",
      "{$variable.base_url}//evil.example/x",
      "{$variable.base_url}/../admin",
      "{$variable.base_url}/a/./b",
      "{$variable.base_url}/%2e%2e/admin",
      "{$variable.base_url}/{$variable.tenant}",
      "{$variable.base_url}mcp",
      "{$credential.token}/mcp",
      "{$outputs.base_url}/mcp",
      "http://{$variable.tenant}.forge.example.com/mcp",
      "https://{$variable.tenant}/mcp",
      "https://{$variable.tenant}.1.2.3/mcp",
      "https://forge.example.com:{$variable.tenant}/mcp",
      "https://x.{$variable.tenant}.example.com/mcp",
      "https://x.example/{$variable.tenant}",
    ]) {
      expectInvalid(integrationManifestSchema, withUrl(url));
    }
    expect(integrationSource.safeParse({ kind: "remote", remote: { url: "https://{$credential.secret}.evil.example/", transport: "sse" } }).success).toBe(false);
  });

  test("the generated JSON Schema mirrors the structural rules", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(import.meta.dir, "../v0/integration.schema.json"), "utf8")));
    expect(validate(selfHosted)).toBe(true);
    expect(validate(hostForm)).toBe(true);
    const example = JSON.parse(readFileSync(join(import.meta.dir, "../../../examples/integration-self-hosted/manifest.json"), "utf8"));
    expect(validate(example)).toBe(true);
    expectValid(integrationManifestSchema, example);
    const withEntry = (uri: string) => ({ ...selfHosted, auths: { token: { ...tokenAuth, authorized_uris: [uri] } } });
    expect(validate(withEntry("https://{$variable.tenant}.forge.example.com:8443?q=1"))).toBe(true);
    for (const uri of ["https://x.example.com/{$variable.tenant}/**", "https://{$variable.tenant}@evil.example/**", "{$variable.tenant}{$variable.tenant}/**"]) {
      expect(validate(withEntry(uri))).toBe(false);
      expectInvalid(integrationManifestSchema, withEntry(uri));
    }
    expect(validate(withUrl("{$variable.base_url}//evil.example"))).toBe(false);
    expect(validate({ ...selfHosted, variables: { schema: { type: "object", properties: { base_url: { type: "number" } } } } })).toBe(false);
    expect(validate({ ...selfHosted, variables: { schema: { type: "object", properties: { BaseUrl: { type: "string" } } } } })).toBe(false);
    expect(validate({ ...selfHosted, variables: { schema: { type: "object", properties: { base_url: true } } } })).toBe(false);
    expect(validate({ ...selfHosted, variables: { schema: { type: "object", properties: {} } } })).toBe(false);
    expect(validate(withOauth({ issuer: "{$variable.base_url}", token_endpoint: "https://evil.example/token" }))).toBe(false);
    expect(validate(withOauth({ token_endpoint: "{$variable.base_url}/token" }))).toBe(false);
    expect(validate({ ...selfHosted, auths: { oauth: { type: "oauth2", delivery: bearer, issuer: "https://forge.example.com" } } })).toBe(false);
    expect(validate({ ...selfHosted, auths: { oauth: { type: "oauth2", delivery: bearer, issuer: "{$variable.base_url}" } } })).toBe(true);
  });
});

describe("credential delivery (§7.6)", () => {
  const base = {
    name: "@test/integration",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.1",
    display_name: "Test",
    source: { kind: "none" },
  };

  function apiKeyAuth(delivery: unknown) {
    return {
      ...base,
      auths: {
        a: {
          type: "api_key",
          credentials: { schema: { type: "object", properties: { k: { type: "string" } } } },
          delivery,
        },
      },
    };
  }

  test("http delivery valid", () => {
    expectValid(
      integrationManifestSchema,
      apiKeyAuth({
        http: { in: "header", name: "Authorization", prefix: "Bearer ", value: "{$credential.k}" },
      }),
    );
  });

  test("http delivery encoding must be base64 when present", () => {
    expectValid(
      integrationManifestSchema,
      apiKeyAuth({ http: { in: "header", name: "Authorization", value: "{$credential.k}", encoding: "base64" } }),
    );
    expectInvalid(
      integrationManifestSchema,
      apiKeyAuth({ http: { in: "header", name: "Authorization", value: "{$credential.k}", encoding: "hex" } }),
    );
  });

  test("http.in enum closed", () => {
    for (const loc of ["header", "query", "cookie"]) {
      expectValid(integrationManifestSchema, apiKeyAuth({ http: { in: loc, name: "X", value: "{$credential.k}" } }));
    }
    expectInvalid(integrationManifestSchema, apiKeyAuth({ http: { in: "body", name: "X", value: "{$credential.k}" } }));
  });

  test("env delivery valid; files mode must be octal", () => {
    expectValid(integrationManifestSchema, apiKeyAuth({ env: { GMAIL_TOKEN: { value: "{$credential.k}", sensitive: true } } }));
    expectValid(integrationManifestSchema, apiKeyAuth({ files: { "/run/creds/token": { value: "{$credential.k}", mode: "0400" } } }));
    expectInvalid(integrationManifestSchema, apiKeyAuth({ files: { "/run/creds/token": { value: "{$credential.k}", mode: "999" } } }));
  });

  test("delivery requires at least one channel", () => {
    expectInvalid(integrationManifestSchema, apiKeyAuth({}));
  });

  test("http is mutually exclusive with env/files", () => {
    expectInvalid(
      integrationManifestSchema,
      apiKeyAuth({
        http: { in: "header", name: "Authorization", value: "{$credential.k}" },
        env: { X: { value: "{$credential.k}" } },
      }),
    );
    expectInvalid(
      integrationManifestSchema,
      apiKeyAuth({
        http: { in: "header", name: "Authorization", value: "{$credential.k}" },
        files: { "/x": { value: "{$credential.k}" } },
      }),
    );
    // env + files together (no http) is allowed
    expectValid(
      integrationManifestSchema,
      apiKeyAuth({ env: { X: { value: "{$credential.k}" } }, files: { "/x": { value: "{$credential.k}" } } }),
    );
  });
});

// ─────────────────────────────────────────────
// §7.7 — connect (custom; login also oauth2; exactly one of login/tool)
// ─────────────────────────────────────────────

describe("connect (§7.7)", () => {
  const base = {
    name: "@test/integration",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.1",
    display_name: "Test",
    source: { kind: "none" },
  };

  const credsSchema = { type: "object", properties: { username: { type: "string" } } };

  test("custom auth with connect.login is valid", () => {
    expectValid(integrationManifestSchema, {
      ...base,
      auths: {
        c: {
          type: "custom",
          credentials: { schema: credsSchema },
          connect: {
            login: {
              request: { method: "POST", url: "https://api.e.com/login", content_type: "application/json" },
              success_criteria: [{ condition: "$statusCode == 200" }],
              outputs: {
                token: "$response.body#/access_token",
                csrf: { from: "cookie", name: "XSRF-TOKEN" },
                sub: { from: "jwt", token: "{$credential.token}", path: "/sub" },
              },
              expires_in_output: "exp",
              identity_outputs: ["sub"],
            },
            limits: { request_timeout_ms: 30000, max_response_bytes: 5000000 },
          },
          delivery: { env: { TOKEN: { value: "{$credential.token}", sensitive: true } } },
        },
      },
    });
  });

  test("connect is rejected on non-custom auth types", () => {
    expectInvalid(integrationManifestSchema, {
      ...base,
      auths: {
        a: {
          type: "api_key",
          credentials: { schema: credsSchema },
          connect: { login: { request: { method: "POST", url: "https://e.com" } } },
          delivery: { env: { X: { value: "{$credential.k}" } } },
        },
      },
    });
  });

  test("connect must contain exactly one of login/tool", () => {
    // neither
    expectInvalid(integrationManifestSchema, {
      ...base,
      auths: {
        c: {
          type: "custom",
          credentials: { schema: credsSchema },
          connect: { limits: {} },
          delivery: { env: { X: { value: "{$credential.k}" } } },
        },
      },
    });
    // both
    expectInvalid(integrationManifestSchema, {
      ...base,
      auths: {
        c: {
          type: "custom",
          credentials: { schema: credsSchema },
          connect: { login: { request: { method: "POST", url: "https://e.com" } }, tool: {} },
          delivery: { env: { X: { value: "{$credential.k}" } } },
        },
      },
    });
  });

  // §7.7 — AFPS-extractor variants are a discriminated union over `from`.
  const withOutput = (output: unknown) => ({
    ...base,
    auths: {
      c: {
        type: "custom",
        credentials: { schema: credsSchema },
        connect: {
          login: {
            request: { method: "POST", url: "https://api.e.com/login" },
            outputs: { x: output },
          },
        },
        delivery: { env: { TOKEN: { value: "{$credential.x}", sensitive: true } } },
      },
    },
  });

  test("connect.login.outputs accepts cookie extractor with name", () => {
    expectValid(integrationManifestSchema, withOutput({ from: "cookie", name: "XSRF-TOKEN" }));
  });

  test("connect.login.outputs accepts jwt extractor with token + path", () => {
    expectValid(
      integrationManifestSchema,
      withOutput({ from: "jwt", token: "{$credential.access}", path: "/sub" }),
    );
  });

  test("connect.login.outputs accepts regex extractor with source + pattern (+ optional group)", () => {
    expectValid(
      integrationManifestSchema,
      withOutput({ from: "regex", source: "$response.body", pattern: "token=([a-z]+)" }),
    );
    expectValid(
      integrationManifestSchema,
      withOutput({
        from: "regex",
        source: "$response.body",
        pattern: "token=([a-z]+)",
        group: 1,
      }),
    );
  });

  test("connect.login.outputs rejects unknown `from` value", () => {
    expectInvalid(integrationManifestSchema, withOutput({ from: "header", name: "X-Token" }));
    expectInvalid(integrationManifestSchema, withOutput({ from: "anything" }));
  });

  test("connect.login.outputs rejects cookie extractor missing `name`", () => {
    expectInvalid(integrationManifestSchema, withOutput({ from: "cookie" }));
  });

  test("connect.login.outputs rejects jwt extractor missing `token` or `path`", () => {
    expectInvalid(integrationManifestSchema, withOutput({ from: "jwt", path: "/sub" }));
    expectInvalid(integrationManifestSchema, withOutput({ from: "jwt", token: "{$credential.t}" }));
  });

  test("connect.login.outputs rejects regex extractor missing `source` or `pattern`", () => {
    expectInvalid(integrationManifestSchema, withOutput({ from: "regex", pattern: "x" }));
    expectInvalid(integrationManifestSchema, withOutput({ from: "regex", source: "x" }));
  });
});

// ─────────────────────────────────────────────
// §7.7 — connect.login on an oauth2 auth method (token request)
// ─────────────────────────────────────────────

describe("connect.login on an oauth2 auth method (§7.7)", () => {
  const TOKEN_ENDPOINT = "https://idp.example.com/oauth/token";
  const request = {
    method: "POST",
    url: TOKEN_ENDPOINT,
    content_type: "application/x-www-form-urlencoded",
    body: "grant_type=refresh_token&refresh_token={{refresh_token}}",
  };
  const oauthAuth = {
    type: "oauth2",
    token_endpoint: TOKEN_ENDPOINT,
    token_endpoint_auth_method: "none",
    credentials: {
      schema: { type: "object", properties: { refresh_token: { type: "string" } }, required: ["refresh_token"] },
    },
    connect: { login: { request } },
    delivery: { http: { in: "header", name: "Authorization", prefix: "Bearer ", value: "{$credential.access_token}" } },
    authorized_uris: ["https://api.example.com/**"],
  };
  const manifest = (auth: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name: "@test/integration",
    version: "1.0.0",
    type: "integration",
    schema_version: "0.3",
    display_name: "Test",
    source: { kind: "none" },
    auths: { oauth: auth },
    ...extra,
  });
  const withAuth = (patch: Record<string, unknown>) => manifest({ ...oauthAuth, ...patch });
  const withRequest = (patch: Record<string, unknown>) =>
    withAuth({ connect: { login: { request: { ...request, ...patch } } } });
  const without = (record: Record<string, unknown>, key: string) => {
    const { [key]: _omitted, ...rest } = record;
    return rest;
  };

  // `<path> <message>` of every issue the Zod schema raises.
  const issuesOf = (value: unknown) => {
    const result = integrationManifestSchema.safeParse(value);
    expect(result.success).toBe(false);
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
  };
  const expectOnlyIssue = (value: unknown, path: string, message: string) => {
    expect(issuesOf(value)).toEqual([`${path} ${message} (§7.7)`]);
  };

  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(
    JSON.parse(readFileSync(join(import.meta.dir, "../v0/integration.schema.json"), "utf8")),
  );
  // Rejected by Zod and, unless `jsonToo` is false, by the generated JSON Schema.
  const expectRejected = (value: unknown, jsonToo = true) => {
    expectInvalid(integrationManifestSchema, value);
    if (jsonToo) expect(validate(value)).toBe(false);
  };

  test("an oauth2 auth with token_endpoint, credentials.schema and connect.login is valid", () => {
    expectValid(integrationManifestSchema, manifest(oauthAuth));
    expect(validate(manifest(oauthAuth))).toBe(true);
    // token_endpoint alone: neither authorization_endpoint nor issuer is required.
    expect("authorization_endpoint" in oauthAuth || "issuer" in oauthAuth).toBe(false);
    // A literal issuer, identity claims and a userinfo endpoint stay available (§7.4).
    const withIssuer = withAuth({
      issuer: "https://idp.example.com",
      userinfo_endpoint: "https://idp.example.com/userinfo",
      identity_claims: { account_id: "$.sub" },
      default_scopes: ["profile"],
    });
    expectValid(integrationManifestSchema, withIssuer);
    expect(validate(withIssuer)).toBe(true);
    // Any grant: an extension grant whose parameters come from credentials.schema.
    const exchange = withRequest({
      body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange&subject_token={{refresh_token}}",
    });
    expectValid(integrationManifestSchema, exchange);
    expect(validate(exchange)).toBe(true);
  });

  test("connect.tool stays custom-only", () => {
    expect(issuesOf(withAuth({ connect: { tool: {} } }))).toContain(
      "auths.oauth.connect.tool connect.tool is only valid for auth methods of type custom",
    );
    expect(validate(withAuth({ connect: { tool: {} } }))).toBe(false);
  });

  test("connect stays invalid on api_key, basic and mtls", () => {
    for (const type of ["api_key", "basic", "mtls"]) {
      const value = withAuth({ type, delivery: { env: { X: { value: "{$credential.refresh_token}" } } }, authorized_uris: undefined });
      expectRejected(value);
    }
  });

  test("the request url MUST equal token_endpoint and is never templated", () => {
    expectOnlyIssue(
      withRequest({ url: "https://idp.example.com/oauth/token/" }),
      "auths.oauth.connect.login.request.url",
      "an oauth2 connect.login request url MUST equal token_endpoint",
    );
    // String equality is Zod only (JSON Schema has no cross-field equality).
    expect(validate(withRequest({ url: "https://evil.example/token" }))).toBe(true);
    expectOnlyIssue(
      withRequest({ url: "https://idp.example.com/{{tenant}}/token" }),
      "auths.oauth.connect.login.request.url",
      "an oauth2 connect.login request url MUST NOT be templated",
    );
    expect(validate(withRequest({ url: "https://idp.example.com/{{tenant}}/token" }))).toBe(false);
  });

  test("method MUST be POST, content_type form-urlencoded, headers absent", () => {
    for (const method of ["GET", "post"]) {
      expectOnlyIssue(withRequest({ method }), "auths.oauth.connect.login.request.method", "an oauth2 connect.login request method MUST be POST");
      expectRejected(withRequest({ method }));
    }
    for (const content_type of [undefined, "application/json", "application/x-www-form-urlencoded; charset=utf-8"]) {
      const value = withRequest({ content_type });
      expectOnlyIssue(
        value,
        "auths.oauth.connect.login.request.content_type",
        "an oauth2 connect.login request content_type MUST be application/x-www-form-urlencoded",
      );
      expectRejected(value);
    }
    for (const headers of [{}, { Authorization: "Basic {{credentials}}" }]) {
      expectOnlyIssue(
        withRequest({ headers }),
        "auths.oauth.connect.login.request.headers",
        "an oauth2 connect.login request MUST NOT declare headers; the consumer authenticates its client itself",
      );
      expectRejected(withRequest({ headers }));
    }
  });

  test("the body carries grant_type and only grant parameters", () => {
    expectOnlyIssue(
      withRequest({ body: undefined }),
      "auths.oauth.connect.login.request.body",
      "an oauth2 connect.login request MUST declare a body carrying grant_type",
    );
    expectRejected(withRequest({ body: undefined }));
    expectOnlyIssue(
      withRequest({ body: "refresh_token={{refresh_token}}" }),
      "auths.oauth.connect.login.request.body",
      "an oauth2 connect.login request body MUST carry grant_type",
    );
    expectRejected(withRequest({ body: "refresh_token={{refresh_token}}" }));
  });

  test("parameter names are literal RFC 6749 param-names, refused alike by Zod and JSON Schema", () => {
    const message = "every parameter name of an oauth2 connect.login request body MUST be a literal RFC 6749 param-name, never percent-encoded or a placeholder";
    for (const extra of ["{{field}}=x", "client%5Fid=x", "a+b=x", "a b=x", "", "=x"]) {
      const value = withRequest({ body: `${request.body}&${extra}` });
      expectOnlyIssue(value, "auths.oauth.connect.login.request.body", message);
      expectRejected(value);
    }
    // A percent-encoded grant_type is not grant_type: both validators refuse it.
    const encoded = withRequest({ body: "grant%5Ftype=refresh_token&refresh_token={{refresh_token}}" });
    expect(issuesOf(encoded)).toEqual([
      `auths.oauth.connect.login.request.body ${message} (§7.7)`,
      "auths.oauth.connect.login.request.body an oauth2 connect.login request body MUST carry grant_type (§7.7)",
    ]);
    expectRejected(encoded);
    // Values keep the placeholder and encoding rules: both validators accept them.
    for (const body of [`${request.body}&scope=a%20b+c`, `${request.body}&extra={{refresh_token}}&empty=`, "grant_type=refresh_token&refresh_token={{refresh_token}}&x=a=b"]) {
      expectValid(integrationManifestSchema, withRequest({ body }));
      expect(validate(withRequest({ body }))).toBe(true);
    }
  });

  test("grant_type is never password nor a placeholder", () => {
    for (const grant of ["password", "pass%77ord", "%70%61%73%73%77%6Frd", "pass%77%6frd"]) {
      const value = withRequest({ body: `grant_type=${grant}&username={{refresh_token}}` });
      expectOnlyIssue(
        value,
        "auths.oauth.connect.login.request.body",
        "the grant_type of an oauth2 connect.login request body MUST NOT be password (RFC 9700 §2.4)",
      );
      expectRejected(value);
    }
    // A duplicate grant_type is checked too.
    expectRejected(withRequest({ body: `${request.body}&grant_type=password` }));
    const templated = withRequest({ body: "grant_type={{refresh_token}}&refresh_token={{refresh_token}}" });
    expectOnlyIssue(
      templated,
      "auths.oauth.connect.login.request.body",
      "the grant_type of an oauth2 connect.login request body MUST NOT carry a placeholder",
    );
    expectRejected(templated);
    // Other grants, and values merely containing `password`, are accepted by both.
    for (const grant of ["passwords", "my_password", "client_credentials"]) {
      const value = withRequest({ body: `grant_type=${grant}&refresh_token={{refresh_token}}` });
      expectValid(integrationManifestSchema, value);
      expect(validate(value)).toBe(true);
    }
  });

  test("connect.limits is refused", () => {
    const value = withAuth({ connect: { login: { request }, limits: { request_timeout_ms: 1000 } } });
    expectOnlyIssue(
      value,
      "auths.oauth.connect.limits",
      "connect.limits MUST NOT be declared on an oauth2 auth method; the consumer's token-request limits apply",
    );
    expectRejected(value);
  });

  test("the body MUST NOT carry client authentication or resource", () => {
    for (const name of ["client_id", "client_secret", "client_assertion", "client_assertion_type", "resource"]) {
      const value = withRequest({ body: `${request.body}&${name}=x` });
      expectOnlyIssue(
        value,
        "auths.oauth.connect.login.request.body",
        `an oauth2 connect.login request body MUST NOT carry ${name}; the consumer adds client authentication and resource itself`,
      );
      expectRejected(value);
    }
    // A parameter value that merely mentions a forbidden name is not that parameter.
    expectValid(integrationManifestSchema, withRequest({ body: `${request.body}&audience=client_id` }));
  });

  test("outputs, success_criteria, expires_in_output and identity_outputs MUST NOT be declared", () => {
    for (const [field, value] of [
      ["outputs", { token: "$response.body#/access_token" }],
      ["success_criteria", [{ condition: "$statusCode == 200" }]],
      ["expires_in_output", "exp"],
      ["identity_outputs", ["sub"]],
    ] as const) {
      const manifestValue = withAuth({ connect: { login: { request, [field]: value } } });
      expectOnlyIssue(
        manifestValue,
        `auths.oauth.connect.login.${field}`,
        `${field} MUST NOT be declared on an oauth2 connect.login; the response is an RFC 6749 token response`,
      );
      expectRejected(manifestValue);
    }
  });

  test("token_endpoint and credentials.schema are required", () => {
    const noEndpoint = manifest(without(oauthAuth, "token_endpoint"));
    expect(issuesOf(noEndpoint)).toEqual([
      "auths.oauth.token_endpoint an oauth2 auth method declaring connect.login requires token_endpoint (§7.7)",
    ]);
    expectRejected(noEndpoint);
    // An issuer does not stand in for token_endpoint here.
    expectRejected(manifest({ ...without(oauthAuth, "token_endpoint"), issuer: "https://idp.example.com" }));
    const noCredentials = manifest(without(oauthAuth, "credentials"));
    expect(issuesOf(noCredentials)).toEqual([
      "auths.oauth.credentials.schema credentials.schema is required for an oauth2 auth method declaring connect.login (§7.5, §7.7)",
    ]);
    expectRejected(noCredentials);
  });

  test("a templated issuer is refused", () => {
    const value = manifest(
      { ...oauthAuth, issuer: "{$variable.base_url}" },
      { variables: { schema: { type: "object", properties: { base_url: { type: "string" } }, required: ["base_url"] } } },
    );
    expect(issuesOf(value)).toContain(
      "auths.oauth.issuer an oauth2 auth method declaring connect.login MUST NOT declare a templated issuer (§7.7)",
    );
    expectRejected(value);
  });

  test("a remote source is refused", () => {
    const value = manifest(oauthAuth, { source: { kind: "remote", remote: { url: "https://mcp.example.com/mcp", transport: "streamable-http" } } });
    expectOnlyIssue(
      value,
      "auths.oauth.connect.login",
      "connect.login on an oauth2 auth method is not allowed when the integration source.kind is remote",
    );
    expectRejected(value);
  });

  test("scope_catalog is refused", () => {
    const value = withAuth({ scope_catalog: [{ value: "profile", label: "Profile" }] });
    expectOnlyIssue(value, "auths.oauth.scope_catalog", "an oauth2 auth method declaring connect.login MUST NOT declare scope_catalog");
    expectRejected(value);
  });

  test("a custom connect.login is unchanged by the oauth2 rules", () => {
    const custom = manifest({
      type: "custom",
      credentials: { schema: { type: "object", properties: { username: { type: "string" } } } },
      connect: {
        login: {
          request: { method: "PUT", url: "https://api.e.com/{{username}}/login", headers: { "X-Client": "a" }, content_type: "application/json", body: '{"client_id":"x"}' },
          success_criteria: [{ condition: "$statusCode == 200" }],
          outputs: { token: "$response.body#/access_token", exp: "$response.body#/exp" },
          expires_in_output: "exp",
          identity_outputs: ["token"],
        },
      },
      scope_catalog: [{ value: "x", label: "X" }],
      delivery: { env: { TOKEN: { value: "{$credential.token}", sensitive: true } } },
    });
    expectValid(integrationManifestSchema, custom);
    expect(validate(custom)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// §7.8 – §7.10 — tools metadata, uri restrictions, setup_guide
// ─────────────────────────────────────────────

describe("integration tools/uris/setup_guide (§7.8 – §7.10)", () => {
  test("per-tool metadata, uri restrictions, setup_guide accepted", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      auths: {
        oauth: {
          ...validIntegrationOauth2.auths.oauth,
          authorized_uris: ["https://api.example.com/**"],
          allow_all_uris: false,
        },
      },
      tools_policy: {
        list_issues: {
          required_scopes: { oauth: ["repo"] },
        },
      },
      icon: "icon.png",
      setup_guide: {
        callback_url_hint: "Set redirect URI to: {{callback_url}}",
        steps: [{ label: "Create app", url: "https://e.com/apps" }, { label: "Copy credentials" }],
      },
    });
  });

  test("required_scopes rejects the legacy flat-array form", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      tools_policy: {
        list_issues: {
          // pre-0.4 shape — now must be a per-auth map { <auth_key>: string[] }
          required_scopes: ["repo"] as never,
        },
      },
    });
  });

  test("required_scopes rejects a malformed auth-key map key", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      tools_policy: {
        list_issues: {
          // map key must match AUTH_KEY_REGEX (^[a-z][a-z0-9_]*$)
          required_scopes: { "Bad-Key": ["repo"] },
        },
      },
    });
  });

  test("setup_guide step requires a label", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      setup_guide: { steps: [{ url: "https://e.com" }] },
    });
  });

  test("allow_undeclared_tools: true is accepted when an oauth2 auth declares default_scopes", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      allow_undeclared_tools: true,
    });
  });

  test("allow_undeclared_tools: true is rejected when only an oauth2 auth exists and it has empty default_scopes", () => {
    expectInvalid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      auths: {
        oauth: {
          ...validIntegrationOauth2.auths.oauth,
          default_scopes: [],
        },
      },
      allow_undeclared_tools: true,
    });
  });

  test("allow_undeclared_tools: true is accepted when the (only) auth is non-oauth2 (api_key)", () => {
    // api_key / basic / custom / mtls have no scope mechanism — the auth is
    // wildcard-usable wholesale, no `default_scopes` required.
    expectValid(integrationManifestSchema, {
      ...validIntegrationApiKey,
      allow_undeclared_tools: true,
    });
  });

  test("allow_undeclared_tools: true accepted on a mixed manifest where the oauth2 has empty default_scopes but a pat is present", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      auths: {
        oauth: {
          ...validIntegrationOauth2.auths.oauth,
          default_scopes: [],
        },
        pat: {
          type: "api_key",
          credentials: {
            schema: { type: "object", properties: { token: { type: "string" } } },
          },
          authorized_uris: ["https://api.example.com/**"],
          delivery: {
            http: {
              in: "header",
              name: "Authorization",
              prefix: "Bearer ",
              value: "{$credential.token}",
            },
          },
        },
      },
      allow_undeclared_tools: true,
    });
  });

  test("allow_undeclared_tools: false (or absent) is always accepted", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      allow_undeclared_tools: false,
    });
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      auths: {
        oauth: {
          ...validIntegrationOauth2.auths.oauth,
          default_scopes: [],
        },
      },
    });
  });

  // The single issue a manifest raises, asserted to sit on `default_tools`.
  const defaultToolsIssue = (manifest: unknown) => {
    const result = integrationManifestSchema.safeParse(manifest);
    if (result.success) throw new Error("expected the manifest to be rejected");
    expect(result.error.issues).toHaveLength(1);
    const issue = result.error.issues[0]!;
    expect(issue.path).toEqual(["default_tools"]);
    return issue;
  };
  // Messages of the two branches of the `string[] | "*"` union, in order.
  const unionBranchMessages = (manifest: unknown) => {
    const issue = defaultToolsIssue(manifest);
    if (issue.code !== "invalid_union") throw new Error(`expected invalid_union, got ${issue.code}`);
    return issue.errors.map((branch) => branch.map((i) => `${i.path.join(".")}: ${i.message}`));
  };
  const NOT_THE_WILDCARD = ': Invalid input: expected "*"';

  test("default_tools accepts an array of tool names, an empty array, or absence", () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      default_tools: ["list_issues", "search_issues"],
    });
    // An empty array declares no default, like an absent field.
    expectValid(integrationManifestSchema, { ...validIntegrationOauth2, default_tools: [] });
    expectValid(integrationManifestSchema, validIntegrationOauth2);
    // Names are not checked against `tools_policy`: the catalog is resolved
    // per `source.kind`, outside the manifest.
    expectValid(integrationManifestSchema, {
      ...validIntegrationOauth2,
      tools_policy: { list_issues: { required_scopes: { oauth: ["repo"] } } },
      default_tools: ["search_issues"],
    });
  });

  test('default_tools: "*" is accepted when allow_undeclared_tools is true', () => {
    expectValid(integrationManifestSchema, {
      ...validIntegrationApiKey,
      allow_undeclared_tools: true,
      default_tools: "*",
    });
  });

  test('default_tools: "*" is rejected unless allow_undeclared_tools is true', () => {
    for (const flag of [{}, { allow_undeclared_tools: false }]) {
      const issue = defaultToolsIssue({ ...validIntegrationApiKey, ...flag, default_tools: "*" });
      expect(issue.code).toBe("custom");
      expect(issue.message).toBe('default_tools: "*" requires allow_undeclared_tools: true');
      // A list of names carries no such requirement.
      expectValid(integrationManifestSchema, { ...validIntegrationApiKey, ...flag, default_tools: ["search"] });
    }
  });

  test('default_tools: "*" with allow_undeclared_tools: true still needs a wildcard-usable auth', () => {
    const { default_scopes: _omitted, ...oauthWithoutScopes } = validIntegrationOauth2.auths.oauth;
    for (const oauth of [oauthWithoutScopes, { ...oauthWithoutScopes, default_scopes: [] }]) {
      const result = integrationManifestSchema.safeParse({
        ...validIntegrationOauth2,
        auths: { oauth },
        allow_undeclared_tools: true,
        default_tools: "*",
      });
      if (result.success) throw new Error("expected the manifest to be rejected");
      // The flag's own rule rejects it; `default_tools` raises nothing.
      expect(result.error.issues).toHaveLength(1);
      const issue = result.error.issues[0]!;
      expect(issue.code).toBe("custom");
      expect(issue.path).toEqual(["allow_undeclared_tools"]);
      expect(issue.message).toStartWith("allow_undeclared_tools: true requires at least one auth to be wildcard-usable");
      expect(result.error.issues.filter((i) => i.path[0] === "default_tools")).toEqual([]);
    }
  });

  test('default_tools: "*" with a non-boolean allow_undeclared_tools is rejected on the flag', () => {
    for (const [flag, received] of [
      ["true", "string"],
      [null, "null"],
    ] as const) {
      const result = integrationManifestSchema.safeParse({
        ...validIntegrationApiKey,
        allow_undeclared_tools: flag,
        default_tools: "*",
      });
      if (result.success) throw new Error("expected the manifest to be rejected");
      // The type error on the flag is the only issue: cross-field rules run
      // on a structurally valid manifest, so `default_tools` raises nothing.
      expect(result.error.issues).toHaveLength(1);
      const issue = result.error.issues[0]!;
      expect(issue.code).toBe("invalid_type");
      expect(issue.path).toEqual(["allow_undeclared_tools"]);
      expect(issue.message).toBe(`Invalid input: expected boolean, received ${received}`);
    }
  });

  test('default_tools: "*" is accepted on a source.kind "none" integration with a non-oauth2 auth', () => {
    // The schema constrains the shape only: what the wildcard selects on a
    // `none` source is the consumer's reading.
    expect(validIntegrationApiKey.source.kind).toBe("none");
    expect(validIntegrationApiKey.auths.token.type).toBe("api_key");
    expectValid(integrationManifestSchema, {
      ...validIntegrationApiKey,
      allow_undeclared_tools: true,
      default_tools: "*",
    });
  });

  test("default_tools rejects a non-string entry", () => {
    expect(unionBranchMessages({ ...validIntegrationOauth2, default_tools: ["list_issues", 1] })).toEqual([
      ["1: Invalid input: expected string, received number"],
      [NOT_THE_WILDCARD],
    ]);
  });

  test('default_tools rejects a bare string other than "*"', () => {
    for (const value of ["all", "list_issues", ""]) {
      expect(unionBranchMessages({ ...validIntegrationOauth2, default_tools: value })).toEqual([
        [": Invalid input: expected array, received string"],
        [NOT_THE_WILDCARD],
      ]);
    }
  });

  test("default_tools rejects a number, an object, a boolean, or null", () => {
    for (const [value, received] of [
      [3, "number"],
      [{ list_issues: true }, "object"],
      [true, "boolean"],
      [null, "null"],
    ] as const) {
      expect(unionBranchMessages({ ...validIntegrationOauth2, default_tools: value })).toEqual([
        [`: Invalid input: expected array, received ${received}`],
        [NOT_THE_WILDCARD],
      ]);
    }
  });

  test("the generated JSON Schema mirrors the default_tools rules", () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    const validate = ajv.compile(JSON.parse(readFileSync(join(import.meta.dir, "../v0/integration.schema.json"), "utf8")));
    // Every error a rejected manifest raises, as `<instancePath> <keyword>`.
    const errorsOf = (manifest: unknown) => {
      expect(validate(manifest)).toBe(false);
      return (validate.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    };

    expect(validate({ ...validIntegrationOauth2, default_tools: ["list_issues", "search_issues"] })).toBe(true);
    expect(validate({ ...validIntegrationOauth2, default_tools: [] })).toBe(true);
    expect(validate(validIntegrationOauth2)).toBe(true);
    expect(validate({ ...validIntegrationApiKey, allow_undeclared_tools: true, default_tools: "*" })).toBe(true);

    // A malformed value fails both branches of the `anyOf`, and nothing else.
    const shapeErrorsOf = (value: unknown) => {
      const errors = errorsOf({ ...validIntegrationOauth2, default_tools: value });
      expect(errors).toContain("/default_tools anyOf");
      expect(errors).toContain("/default_tools const");
      expect(errors.filter((e) => !e.startsWith("/default_tools"))).toEqual([]);
      return errors;
    };
    expect(shapeErrorsOf(["list_issues", 1])).toContain("/default_tools/1 type");
    for (const value of ["all", 3, { list_issues: true }]) {
      expect(shapeErrorsOf(value)).toContain("/default_tools type");
    }
    // "*" without the flag: the `if`/`then` rule fails, not the property shape.
    expect(errorsOf({ ...validIntegrationApiKey, default_tools: "*" })).toEqual([" required", " if"]);
    expect(errorsOf({ ...validIntegrationApiKey, allow_undeclared_tools: false, default_tools: "*" })).toEqual([
      "/allow_undeclared_tools const",
      " if",
    ]);
    // A non-boolean flag fails the `if`/`then` rule and its own `type`.
    for (const flag of ["true", null]) {
      expect(errorsOf({ ...validIntegrationApiKey, allow_undeclared_tools: flag, default_tools: "*" })).toEqual([
        "/allow_undeclared_tools const",
        " if",
        "/allow_undeclared_tools type",
      ]);
    }
  });
});

// ─────────────────────────────────────────────
// §10 — Extensibility (_meta)
// ─────────────────────────────────────────────

describe("extensibility — _meta (§10)", () => {
  test("_meta with reverse-DNS keys preserved on agent", () => {
    const manifest = {
      ...validAgent,
      _meta: {
        "dev.afps/policy": { tier: "high" },
        "com.example/cost-center": { team: "eng" },
      },
    };
    const result = agentManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      const meta = (result.data as Record<string, unknown>)._meta as Record<string, unknown>;
      expect(meta["dev.afps/policy"]).toEqual({ tier: "high" });
    }
  });

  test("_meta values must be objects", () => {
    expectInvalid(agentManifestSchema, { ...validAgent, _meta: { "dev.afps/x": "string-not-object" } });
  });

  test("_meta accepts a bare name and a vendor reverse-DNS prefix (§10.1)", () => {
    expectValid(agentManifestSchema, { ...validAgent, _meta: { policy: { tier: "high" } } });
    expectValid(agentManifestSchema, {
      ...validAgent,
      _meta: { "com.example/x": { a: 1 } },
    });
  });

  test("_meta rejects MCP-reserved prefixes (§10.1)", () => {
    expectInvalid(agentManifestSchema, { ...validAgent, _meta: { "mcp/foo": { a: 1 } } });
    expectInvalid(agentManifestSchema, {
      ...validAgent,
      _meta: { "modelcontextprotocol.io/x": { a: 1 } },
    });
  });

  test("_meta rejects malformed keys (§10.1 / Appendix B META_NAMESPACE_KEY)", () => {
    expectInvalid(agentManifestSchema, { ...validAgent, _meta: { "bad key": { a: 1 } } });
    // single-label prefix is not a valid reverse-DNS prefix
    expectInvalid(agentManifestSchema, { ...validAgent, _meta: { "single/x": { a: 1 } } });
  });

  test("unknown top-level fields are preserved (looseObject)", () => {
    const manifest = { ...validSkill, "x-custom": "preserved" };
    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["x-custom"]).toBe("preserved");
    }
  });
});
