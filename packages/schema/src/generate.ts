// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 AFPS contributors

/**
 * Generate AFPS JSON Schema files from the Zod definitions.
 *
 * Change MAJOR to generate schemas for a different spec version.
 *
 * Usage:
 *   bun src/generate.ts          Generate/update JSON schemas
 *   bun src/generate.ts --check  Verify committed schemas match Zod source (CI)
 */

import { toJSONSchema } from "zod/v4/core";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import {
  createSchemas,
  afpsJsonSchemaOverride,
  VARIABLE_AUTHORITY_FORM_ENTRY,
  VARIABLE_NAME_REGEX,
  VARIABLE_URL_FORM_ENTRY,
} from "./schemas.ts";

const MAJOR = 0;
const VERSION_TAG = `v${MAJOR}`;
const BASE_URL = "https://schemas.afps.dev";
const OUTPUT_DIR = resolve(dirname(import.meta.filename!), "..", VERSION_TAG);

const isCheck = process.argv.includes("--check");

/**
 * Cross-field MUST rules that the Zod `.superRefine` enforces but
 * `toJSONSchema` cannot express. We inject the JSON Schema 2020-12
 * equivalents (`if`/`then`/`anyOf`/`oneOf`/`minProperties`) so that
 * JSON-only validators reject the same shapes the Zod runtime rejects.
 *
 * Keep these in lockstep with the `.superRefine` logic in `schemas.ts`
 * (§7.3, §7.5, §7.6, §7.7, §7.12, §3.4).
 */
function applyCrossFieldRules(filename: string, schema: Record<string, any>): void {
  if (filename === "integration.schema.json") {
    // §3.5 — at least one auth method.
    schema.properties.auths.minProperties = 1;

    // §7.12 — the literal branch of `source.remote.url` and `issuer` excludes `{$`, so a
    // template is accepted only by the URL_TEMPLATE_REGEX branch (`format: "uri"` is an
    // annotation for most JSON Schema validators).
    const NO_TEMPLATE = { pattern: "\\{\\$" };
    const method = schema.properties.auths.additionalProperties as Record<string, any>;
    const remote = schema.properties.source.oneOf.find(
      (variant: Record<string, any>) => variant.properties.kind.const === "remote",
    );
    for (const field of [remote.properties.remote.properties.url, method.properties.issuer]) {
      field.anyOf[0].not = NO_TEMPLATE;
    }

    // §7.12 — at least one variable, each named per VARIABLE_NAME_REGEX and of
    // `type: "string"`. (Every variable listed in `required`, and placeholders
    // naming declared variables, relate values to each other: Zod only.)
    schema.properties.variables.properties.schema.allOf.push({
      properties: {
        properties: {
          minProperties: 1,
          propertyNames: { pattern: VARIABLE_NAME_REGEX.source },
          additionalProperties: { type: "object", properties: { type: { const: "string" } }, required: ["type"] },
        },
      },
    });

    method.allOf = [
      // §7.5 — credentials.schema required for api_key/basic/mtls/custom.
      {
        if: { properties: { type: { enum: ["api_key", "basic", "mtls", "custom"] } }, required: ["type"] },
        then: { required: ["credentials"], properties: { credentials: { required: ["schema"] } } },
      },
      // §7.7 — connect only valid for custom; exactly one of login/tool.
      {
        if: { required: ["connect"] },
        then: {
          properties: {
            type: { const: "custom" },
            connect: {
              oneOf: [
                { required: ["login"], not: { required: ["tool"] } },
                { required: ["tool"], not: { required: ["login"] } },
              ],
            },
          },
          required: ["type"],
        },
      },
    ];

    // §7.3 — endpoints and `resource` are never templated, and a templated issuer
    // leaves them to discovery.
    // §7.9 — an `authorized_uris` entry carrying a variable takes the URL form or the
    // authority form with the variable filling the host.
    method.properties.authorized_uris.items.anyOf = [
      { not: { pattern: "\\{\\$variable\\." } },
      { pattern: VARIABLE_URL_FORM_ENTRY.source },
      { pattern: VARIABLE_AUTHORITY_FORM_ENTRY.source },
    ];

    const DISCOVERED = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "resource"];
    for (const field of DISCOVERED) method.properties[field].not = NO_TEMPLATE;
    method.allOf.push({
      if: { properties: { type: { const: "oauth2" }, issuer: { pattern: "\\{\\$" } }, required: ["type", "issuer"] },
      then: { not: { anyOf: DISCOVERED.map((field) => ({ required: [field] })) } },
    });

    // §7.3 — oauth2 requires issuer (discovery) OR both endpoints, EXCEPT when
    // the integration `source.kind` is `remote`: a remote MCP server is an
    // OAuth protected resource whose authorization server is discovered at
    // connect time from `source.remote.url` (RFC 9728 → RFC 8414), so its
    // oauth2 auth MAY omit both. This rule lives at the manifest root because it
    // cross-references `source` (sibling of `auths`); when the source is
    // `remote` the per-auth oauth2 endpoint requirement is lifted.
    schema.allOf = [
      {
        if: {
          properties: { source: { properties: { kind: { const: "remote" } }, required: ["kind"] } },
          required: ["source"],
        },
        then: true,
        else: {
          properties: {
            auths: {
              additionalProperties: {
                allOf: [
                  {
                    if: { properties: { type: { const: "oauth2" } }, required: ["type"] },
                    then: {
                      anyOf: [
                        { required: ["issuer"] },
                        { required: ["authorization_endpoint", "token_endpoint"] },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ];
    // §7.3 — a templated `source.remote.url` leaves every oauth2 auth's endpoints
    // and `resource` to remote MCP authorization; an issuer is then a template
    // (over the URL's variables: Zod only).
    schema.allOf.push({
      if: {
        properties: {
          source: {
            properties: {
              kind: { const: "remote" },
              remote: { properties: { url: { pattern: "\\{\\$" } }, required: ["url"] },
            },
            required: ["kind", "remote"],
          },
        },
        required: ["source"],
      },
      then: {
        properties: {
          auths: {
            additionalProperties: {
              if: { properties: { type: { const: "oauth2" } }, required: ["type"] },
              then: {
                properties: { issuer: { pattern: "\\{\\$" } },
                not: { anyOf: DISCOVERED.map((field) => ({ required: [field] })) },
              },
            },
          },
        },
      },
    });

    // §7.6 — ≥1 delivery channel; http exclusive of env/files.
    const delivery = method.properties.delivery as Record<string, any>;
    delivery.allOf = [
      { anyOf: [{ required: ["http"] }, { required: ["env"] }, { required: ["files"] }] },
      {
        if: { required: ["http"] },
        then: { not: { anyOf: [{ required: ["env"] }, { required: ["files"] }] } },
      },
    ];
  }

  if (filename === "mcp-server.schema.json") {
    // §3.4 — server.type "uv" requires manifest_version "0.4".
    schema.allOf = [
      {
        if: {
          properties: { server: { properties: { type: { const: "uv" } }, required: ["type"] } },
          required: ["server"],
        },
        then: { properties: { manifest_version: { const: "0.4" } } },
      },
    ];
  }
}

const {
  agentManifestSchema,
  skillManifestSchema,
  mcpServerManifestSchema,
  integrationManifestSchema,
} = createSchemas(MAJOR);

const entries = [
  {
    filename: "agent.schema.json",
    title: "AFPS Agent Manifest",
    description:
      "Manifest schema for AFPS 0.3 agent packages. " +
      "An agent declares dependencies, input/output schemas, a timeout hint, and per-integration configuration.",
    schema: agentManifestSchema,
  },
  {
    filename: "skill.schema.json",
    title: "AFPS Skill Manifest",
    description:
      "Manifest schema for AFPS 0.3 skill packages. " +
      "A skill is a superset of the Agent Skills format with package identity and versioning.",
    schema: skillManifestSchema,
  },
  {
    filename: "mcp-server.schema.json",
    title: "AFPS MCP-Server Manifest",
    description:
      "Manifest schema for AFPS 0.3 mcp-server packages. " +
      "The manifest is AFPS-native at the root (type, schema_version, scoped name, dependencies) and adopts " +
      "the MCPB field vocabulary (manifest_version, server, tools, user_config) verbatim; it is not a strict MCPB manifest.",
    schema: mcpServerManifestSchema,
  },
  {
    filename: "integration.schema.json",
    title: "AFPS Integration Manifest",
    description:
      "Manifest schema for AFPS 0.3 integration packages. " +
      "An integration declares a capability source, one or more authentication methods, and credential delivery.",
    schema: integrationManifestSchema,
  },
];

if (!isCheck) {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

let mismatch = false;

for (const entry of entries) {
  const jsonSchema = toJSONSchema(entry.schema, {
    unrepresentable: "any",
    target: "draft-2020-12",
    override: afpsJsonSchemaOverride,
  }) as Record<string, unknown>;

  delete jsonSchema.$schema;

  applyCrossFieldRules(entry.filename, jsonSchema);

  const final = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${BASE_URL}/${VERSION_TAG}/${entry.filename}`,
    $comment: "SPDX-License-Identifier: Apache-2.0 — Copyright (c) 2026 AFPS contributors",
    title: entry.title,
    description: entry.description,
    ...jsonSchema,
  };

  const generated = JSON.stringify(final, null, 2) + "\n";
  const filePath = resolve(OUTPUT_DIR, entry.filename);

  if (isCheck) {
    let committed: string;
    try {
      committed = await readFile(filePath, "utf-8");
    } catch {
      console.error(`  ✗ ${VERSION_TAG}/${entry.filename} — file missing`);
      mismatch = true;
      continue;
    }
    if (committed !== generated) {
      console.error(`  ✗ ${VERSION_TAG}/${entry.filename} — out of date`);
      mismatch = true;
    } else {
      console.log(`  ✓ ${VERSION_TAG}/${entry.filename}`);
    }
  } else {
    await writeFile(filePath, generated);
    console.log(`  ✓ ${VERSION_TAG}/${entry.filename}`);
  }
}

if (isCheck) {
  if (mismatch) {
    console.error("\nJSON schemas are out of date. Run `bun run generate` to update.");
    process.exit(1);
  }
  console.log("\nAll JSON schemas are up to date.");
} else {
  console.log(`\nGenerated ${entries.length} schemas in ${OUTPUT_DIR}`);
}
