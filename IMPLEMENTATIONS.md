# Implementations

Known implementations of the AFPS specification. To add yours, open a pull request.

## Reference Implementation

| Implementation | Language | Description |
| --- | --- | --- |
| [`@appstrate/core`](https://www.npmjs.com/package/@appstrate/core) | TypeScript / Zod 4 | Manifest validation, ZIP parsing, dependency extraction, semver, naming |

Known deviation: the Appstrate implementation refuses `variables` on an unauthenticated integration (§7.2), although §4.4 allows them. It holds variable values on a connection, and an unauthenticated integration has no connection.

The JSON Schema files in [`schema/`](./schema/) are included in this repository for self-contained reference.

## Community Implementations

*None yet. If you build an AFPS producer, consumer, or registry, open a PR to list it here.*
