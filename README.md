# OpenAPI Snippets Generator

CLI tool that takes an OpenAPI spec and injects `x-codeSamples` per endpoint for documentation renderers like Redoc and Swagger UI.

## Installation

### Global install

```bash
npm install -g .
# or publish to a registry and:
# npm install -g openapi-snippets
```

Then run directly:

```bash
openapi-snippets -i spec.yaml -l 'shell:curl,node:axios,python:requests'
```

### Local (project-level)

```bash
npm install
npm run build
node dist/cli.js -i combined_output.yaml -l 'shell:curl,node:axios,python:requests'
redocly build-docs combined_output_updated.yaml --output combined_output.html
```

## Quick Start

```bash
# Inject x-codeSamples into a copy of the spec (combined_output_updated.yaml)
openapi-snippets -i combined_output.yaml -l 'shell:curl,node:axios,python:requests'

# Target specific operations
openapi-snippets -i combined_output.yaml -l 'shell:curl,node:axios' \
  --operation-ids 'query_users,create_user'
```

## What It Does

1. Parses an OpenAPI 3.x spec (YAML or JSON)
2. Generates code snippets for every endpoint using the selected languages/clients
3. Writes a new `<filename>_updated.<ext>` file with `x-codeSamples` injected per operation
4. Renderers like Redoc display a language selector with runnable examples for each endpoint

## CLI Reference

```
Required:
  -i, --input <path>          OpenAPI file path
  -l, --languages <list>      Comma-separated language:client pairs

Options:
  --operation-ids <ids>       Comma-separated operation IDs to include
  --include-tags <tags>       Comma-separated tags to include
  --exclude-tags <tags>       Comma-separated tags to exclude
  --path-regex <regex>        Regex to filter paths
  --methods <methods>         Comma-separated HTTP methods (GET,POST,PUT,DELETE)
  --auth-file <path>          JSON file with auth config
  --server-index <index>      Server index from spec (default: 0)
  --server-vars <vars>        Server variable overrides (key=value,key2=value2)
  --include-optional          Include optional parameters in snippets
```

## Supported Languages

| Language | Clients                                 |
| -------- | --------------------------------------- |
| `shell`  | `curl`                                  |
| `node`   | `axios`, `native`, `unirest`, `request` |
| `python` | `requests`, `python3`                   |
| `java`   | `okhttp`, `unirest`, `httpcomponents`   |
| `go`     | `native`                                |
| `csharp` | `httpclient`, `restsharp`               |
| `ruby`   | `native`, `net-http`                    |
| `php`    | `curl`, `guzzle`                        |
| `swift`  | `nsurlsession`, `urlsession`            |
| `kotlin` | `okhttp`                                |

## Usage Examples

### Inject code samples into spec

```bash
# All operations, 5 languages
openapi-snippets -i combined_output.yaml \
  -l 'shell:curl,node:axios,python:requests,go,java:okhttp'
# Outputs: combined_output_updated.yaml
```

### Filter by tags or methods

```bash
openapi-snippets -i combined_output.yaml \
  -l 'shell:curl,node:axios' \
  --include-tags 'querytimescale_fixed_search' \
  --methods GET,POST
```

### Authentication

Create `auth.json`:

```json
{
  "bearerToken": "your-token-here"
}
```

```bash
openapi-snippets -i openapi.yaml -l 'shell:curl' --auth-file auth.json
```

## Output

Writes `<input>_updated.<ext>` in the same directory as the input file. The original file is never modified.

### x-codeSamples format

The injected `x-codeSamples` use the Redoc extension format:

```yaml
paths:
  /api/v1/users:
    get:
      x-codeSamples:
        - lang: Shell (curl)
          label: shell-curl
          source: |
            curl --request GET \
                 --url https://example.com/api/v1/users \
                 --header 'accept: application/json'
        - lang: Node.js (axios)
          label: node-axios
          source: |
            import axios from 'axios';
            ...
```

## Exit Codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | All snippets generated successfully      |
| 1    | Failure (parse error, invalid spec, etc) |

## Programmatic Usage

```typescript
import { generate } from './dist/index.js';

await generate({
  input: './openapi.yaml',
  languages: [
    { language: 'shell', client: 'curl' },
    { language: 'node', client: 'axios' },
  ],
  filters: { includeTags: ['public'] },
  auth: {},
  server: { index: 0, variables: {} },
  includeOptional: false,
});
// Writes ./openapi_updated.yaml with x-codeSamples
```

## Technical Details

- **Snippet generation**: `@readme/oas-to-snippet` (primary) with `@readme/oas-to-har` + `@readme/httpsnippet` fallback
- **Spec parsing**: `oas-normalize` + `oas`
- **YAML handling**: `js-yaml`
- **Language target format**: oasToSnippet expects `[language, client]` arrays, not `"lang:client"` strings
- **Spec output format**: `_updated` files preserve the original format (YAML stays YAML, JSON stays JSON)

## License

MIT
