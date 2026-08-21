# Changelog

## v0.3 — 2026-08-21

### Removed

- `agent.config` — an agent's parameters are now declared in `input`. Whether a
  value is asked on every run or persisted at setup is a consumer concern, not a
  format concern. A 0.2 manifest carrying `config` remains valid per §3 (unknown
  top-level fields are allowed and SHOULD be preserved) but is no longer described
  by this specification.

## Schema `@afps-spec/schema@0.6.1` — 2026-06-08

Editorial change (no validation semantics change — every manifest valid under
0.6.0 stays valid, and the `schema_version` regex is unchanged).

- `schema_version` authoring DX: the `MAJOR.MINOR` format hint now also rides
  the `invalid_type` path, so an **omitted** required `schema_version` reports
  the expected shape instead of the bare "expected string, received undefined".
  The field also gained a `.describe()` annotation that flows into the generated
  v0 JSON Schemas (and surfaces in JSON Schema / MCP `describe_operation`
  consumers). Both messages note `schema_version` is distinct from the semver
  `version` field in the same manifest. Generated `v0/*.schema.json` carry the
  new `description`; no `type` / `pattern` / `required` changed.

## Schema `@afps-spec/schema@0.6.0` — 2026-06-03

Additive schema change (relaxation — no manifest that validated under 0.5.0
becomes invalid).

- §7.3 oauth2 issuer-or-endpoints requirement is now **waived for `remote`
  sources**. A remote MCP server is an OAuth 2.0 protected resource whose
  authorization server is not known until connect time; the consumer discovers
  it from `source.remote.url` (RFC 9728 protected-resource metadata → RFC 8414
  authorization-server metadata) and obtains a client without manual
  pre-registration (CIMD or RFC 7591 DCR). An `oauth2` auth on a `remote`
  integration MAY therefore omit both `issuer` and the explicit
  `authorization_endpoint` / `token_endpoint`. Non-remote sources are unchanged:
  they still require `issuer` OR both endpoints. The Zod schema threads
  `source.kind` into the per-auth refinement; the generated JSON Schema lifts the
  oauth2 rule to a root-level `if (source.kind == "remote") then true else <rule>`.

## Schema `@afps-spec/schema@0.5.0` — 2026-05-28

Additive schema change.

- `integration.allow_undeclared_tools: boolean` (default `false`) — opt-in author
  flag. When `true`, an agent MAY set `integrations_configuration.<id>.tools = "*"`
  to bypass the per-tool allowlist and pass through every tool the upstream MCP
  server advertises at runtime. Requires at least one **wildcard-usable** auth:
  either a non-`oauth2` auth (`api_key`/`basic`/`custom`/`mtls` — no scope
  mechanism, the wholesale grant covers any tool) or an `oauth2` auth with a
  non-empty `default_scopes` (the fallback scope set when an agent picks that
  auth under wildcard). The Zod schema enforces this cross-field rule via
  `superRefine`; the generated JSON Schema declares the property but does not
  encode the correlation (JSON Schema `if`/`then` over a variadic auth map is
  impractical), so consumers that validate via JSON Schema alone MUST
  re-implement that check.
- `integrations_configuration.<id>.tools` widened from `string[]` to
  `string[] | "*"`. The wildcard literal opts the agent into all upstream tools;
  consumers MUST reject it unless the referenced integration declares
  `allow_undeclared_tools: true`.

## Schema `@afps-spec/schema@0.4.0` — 2026-05-27

Breaking schema change (no spec-version bump; `0.x` makes no back-compat promise).

- `integration.tools_policy.<tool>.required_scopes` is now a **per-auth map**
  `{ <auth_key>: string[] }` (was a flat `string[]`). Scopes are declared against
  the specific auth that grants them; each map key MUST be a declared `auths` key
  and its scopes MUST be a subset of that auth's `scope_catalog`.
- Removed `tools_policy.<tool>.scope_auth_key` — the per-auth map makes the scope
  anchor explicit, so the separate selector is redundant.
- Removed `tools_policy.<tool>.url_patterns` — per-tool URL allowlisting is
  redundant with the auth-method `authorized_uris` floor (a single MCP server has
  one address; per-tool URLs added no enforceable granularity).

(Schema `0.2.0`/`0.3.0` — `integrations_configuration` split — were published
without a changelog entry.)

## v0.1.0 — 2026-05-26

Initial public draft of the Agent Format Packaging Standard.

AFPS was reset to `0.1` to honestly signal its draft, pre-stable status: as a
`0.x` specification, every part — field names, package model, schema system —
may change before a stable `1.0`, with no backward-compatibility commitment
between minor revisions. All previously published `@afps-spec/*` package
versions are withdrawn; `0.1.0` is the first supported release.

### Specification

- Four package types: `agent`, `skill`, `mcp-server`, `integration`.
- `snake_case` field vocabulary across all types.
- Scoped package identity (`@scope/name`) + semantic versioning.
- Dependency model with compact (semver string) and object forms; per-integration
  `scopes` / `auth_key` configuration.
- JSON Schema 2020-12 based `input` / `output` / `config` schema system.
- `mcp-server` is AFPS-native at the root and adopts the MCPB field vocabulary
  (`manifest_version`, `server`, `tools`, `user_config`).
- `integration` wraps a capability `source` (`local` / `remote` / `api`) with an
  `auths` map, credential delivery (`http` / `env` / `files`), declarative
  credential acquisition (`connect`), per-tool policy, and URI restrictions.
- OAuth 2.0 / OIDC discovery vocabulary (RFC 8414 / OIDC Discovery), PKCE
  (RFC 7636), resource indicators (RFC 8707).
- `_meta` reverse-DNS extension mechanism; `dev.afps/` reserved namespace.

### Schema (`@afps-spec/schema@0.1.0`)

- Zod source of truth + generated JSON Schema 2020-12 files at
  `https://schemas.afps.dev/v0/{agent,skill,mcp-server,integration}.schema.json`.
- Cross-field MUST rules emitted into the JSON Schemas (auths ≥1; oauth2
  issuer-or-endpoints; conditional `credentials.schema`; `connect` only on
  `custom` with exactly one of `login`/`tool`; delivery ≥1 channel with `http`
  exclusive of `env`/`files`; `server.type: "uv"` ⇒ `manifest_version: "0.4"`).
- `_meta` key validation (namespaced-key pattern + MCP reserved-prefix rule).
- Typed MCPB `user_config` entries; full RFC 7591 `token_endpoint_auth_method`
  set; URL format on OAuth endpoints + `source.remote.url`.

### Domain

- Vendor-neutral `afps.dev` home; documentation site on the apex, JSON Schemas
  served from `https://schemas.afps.dev/v0/` (GitHub Pages). Schema `$id`s use
  that host.
