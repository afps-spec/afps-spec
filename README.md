# Agent Format Packaging Standard (AFPS)

![AFPS v0.3](https://img.shields.io/badge/AFPS-v0.3-blue)

AFPS is an open specification for declaring portable AI workflow packages.
It standardizes how agents, skills, and integrations (including the local MCP servers integrations carry) are described, versioned, and distributed.
It focuses on package definition and composition, not on tool calling or agent-to-agent transport.

## Ecosystem Positioning

Existing AI standards each package a single artifact type (MCPB → one MCP server; Agent Skills → one skill; A2A AgentCard → one runtime agent endpoint). AFPS is a **packaging-and-composition format**: one archive declares an agent's goal **and** every skill, MCP server, and integration it needs, with versioned dependencies between them.

```text
  ─────────────────────────────────────────────────────────────────────
  Distribution    │ AFPS Registry · npm · OCI · any HTTP store        │  not in spec —
                  │ (hosts versioned .afps archives)                  │  transport-agnostic
  ─────────────────────────────────────────────────────────────────────
                                    ▲ publish / fetch
                                    │
  ─────────────────────────────────────────────────────────────────────
  Packaging       │ ┌───────────────────────────────────────────────┐ │
  (this spec)     │ │  AFPS  .afps  (ZIP)                           │ │
                  │ │  manifest.json + companions                   │ │
                  │ │  ┌─────────┬───────┬───────────────────────┐  │ │
                  │ │  │ agent   │ skill │                       │  │ │
                  │ │  │ (NEW)   │       │                       │  │ │
                  │ │  ├─────────┴───────┴───────────────────────┤  │ │
                  │ │  │ integration: source + auths + delivery │  │ │
                  │ │  │ (local source: inline server, MCPB vocab)│ │ │
                  │ │  └────────────────────────────────────────┘  │ │
                  │ └───────────────────────────────────────────────┘ │
  ─────────────────────────────────────────────────────────────────────
                                    ▲ consumed by
                                    │
  ─────────────────────────────────────────────────────────────────────
  Runtime         │ Agent runtime executes prompt.md, resolves        │  not in spec
                  │ dependencies, applies integration auth            │
  ─────────────────────────────────────────────────────────────────────
                                    ▲ talks to services via
                                    │
  ─────────────────────────────────────────────────────────────────────
  Wire protocols  │ MCP (tool calls) · HTTP/REST · A2A (agent-to-     │  not in spec
                  │ agent)                                            │
  ─────────────────────────────────────────────────────────────────────
```

Peer packaging formats and AFPS's relation to each:

```text
  Format         │ What it packages                  │ AFPS relation
  ───────────────┼───────────────────────────────────┼────────────────────────────────
  MCPB           │ a single local MCP server         │ field vocab adopted by local source
  Agent Skills   │ a single capability (SKILL.md)    │ superset adopted by skill
  A2A AgentCard  │ runtime discovery of one agent    │ optional, attached via _meta
  npm package    │ generic JS/TS code distribution   │ metadata fields aligned
  ───────────────┼───────────────────────────────────┼────────────────────────────────
  AFPS           │ goal + skills + integrations      │ this spec — one archive,
                 │ (with their local servers) +      │ three artifact types,
                 │ dependencies + schemas — in a ZIP │ versioned + composable
```

- **MCP** defines runtime tool invocation. AFPS does not define tool-calling transport; a runtime MAY choose to expose AFPS capabilities via MCP.
- **MCPB** defines how a local MCP server is packaged. The `source.server` of an AFPS `local` integration adopts the MCPB field vocabulary (`type`, `entry_point`, `mcp_config`, `tools`) and the integration archive carries the server payload. The archive is not a strict MCPB bundle; the spec defines a mechanical projection to and from one (§7.1.1).
- **Agent Skills** defines reusable capabilities (`SKILL.md`). AFPS skill packages are a strict superset: a valid Agent Skill directory becomes an AFPS skill when a `manifest.json` is added. The `SKILL.md` format, frontmatter fields, and optional directories (`scripts/`, `references/`, `assets/`) are preserved unchanged. AFPS adds identity, versioning, and dependency resolution.
- **A2A** defines inter-agent communication. AFPS does not compete — A2A metadata can be added via the `_meta` extension mechanism.

No existing standard covers the *composition* layer: structured workflow packages with dependency resolution, semantic versioning, integration auth metadata, and a single distribution archive. AFPS fills that gap.

## Quick Start

Create a minimal agent package with two files:

**`manifest.json`**
```json
{
  "name": "@my-org/hello-world",
  "version": "1.0.0",
  "type": "agent",
  "schema_version": "0.3",
  "display_name": "Hello World",
  "author": "My Org",
  "dependencies": {}
}
```

**`prompt.md`**
```markdown
Summarize the latest unread emails and list any action items.
```

ZIP both files together (using the `.afps` extension by convention) — that's a valid AFPS agent package. See [examples/](./examples/) for more, or read the [primer](./primer.md) for a guided introduction.

### How an agent composes its dependencies

A real agent declares its dependencies in two named maps (`skills`, `integrations`), each a flat record of package id to semver range. Per-integration configuration (`tools`, `scopes`, `auth_key`, `required`) lives in the separate top-level `integrations_configuration` map. A local MCP server is declared inline by an integration whose `source.kind` is `"local"`; the integration archive carries the server payload, and a server that needs no credentials simply omits `auths`.

```text
  ┌──────────────────────────────────────────────────────────────────────┐
  │  @acme/customer-intake  (type: agent · v1.0.0 · .afps ZIP)           │
  │                                                                      │
  │  "dependencies": {                                                   │
  │    "skills":       { "@acme/rewrite-tone": "^1.0.0" },               │
  │    "integrations": { "@acme/gmail":        "^1.0.0" }                │
  │  },                                                                  │
  │  "integrations_configuration": {                                     │
  │    "@acme/gmail": { "tools":    ["list_messages"],                   │
  │                     "scopes":   ["gmail.read"],                      │
  │                     "auth_key": "oauth",                             │
  │                     "required": true }                               │
  │  }                                                                   │
  └────────┬──────────────────────┬───────────────────────┬──────────────┘
           │ resolves against     │
           │ a package catalog    │
           │ (semver range →      │
           │  concrete version)   │
           ▼                      ▼
  ┌──────────────────┐  ┌──────────────────────────┐
  │ @acme/           │  │ @acme/gmail              │
  │ rewrite-tone     │  │ (integration)            │
  │ (skill)          │  │ auths: { oauth, apikey } │
  │ SKILL.md +       │  │ source.kind: "local"     │
  │ scripts/ ...     │  │ source.server: inline    │
  │                  │  │ server/ payload in the   │
  │                  │  │ archive; runtime injects │
  │                  │  │ the OAuth token at run   │
  └──────────────────┘  └──────────────────────────┘
```

Each box is one published `.afps` archive. See the [primer](./primer.md) for a worked example with the full manifest contents.

## Repository Contents

- [spec.md](./spec.md) — the AFPS v0.3 draft specification
- [primer.md](./primer.md) — non-normative introduction for newcomers
- [examples/](./examples/) — minimal and full package examples (agent, skill, integration)
- [packages/](./packages/) — reference TS artefacts published to npm under `@afps-spec/*`
  - [packages/schema/](./packages/schema/) — JSON Schema + Zod (see [README](./packages/schema/README.md))
  - [packages/types/](./packages/types/) — TS bindings for AFPS 0.3 contracts
- [GOVERNANCE.md](./GOVERNANCE.md) — change process and stewardship
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to contribute
- [CHANGELOG.md](./CHANGELOG.md) — specification history

## Scope

AFPS defines:

- Package identity with scoped names and semantic versions
- Manifest fields for `agent`, `skill`, and `integration` (a `local` integration declares its MCP server inline and ships the payload)
- A dependency model with semver ranges and separate per-integration configuration (tool selection, requested OAuth scopes)
- A JSON Schema 2020-12 based schema system for input and output
- ZIP package structure for distribution
- Integration authentication metadata: OAuth 2.0 / OIDC discovery, credential schema, credential delivery (`http` / `env` / `files`), declarative credential acquisition (`connect`), per-tool policy, URI restrictions, and setup-guide hints

AFPS does not define:

- Agent runtime APIs
- Prompt execution semantics
- Tool invocation transport
- Agent-to-agent messaging

## Origin

AFPS is published as an independent, vendor-neutral open specification.

## Implementations

See [IMPLEMENTATIONS.md](./IMPLEMENTATIONS.md) for known implementations.

## Contributing

See [GOVERNANCE.md](./GOVERNANCE.md) for the change process.
To propose a normative or editorial change, open an issue using the [spec change template](./.github/ISSUE_TEMPLATE/spec-change.yml).

## License

All content in this repository is licensed under [Apache-2.0](./LICENSE).

