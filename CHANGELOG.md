# Changelog

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
