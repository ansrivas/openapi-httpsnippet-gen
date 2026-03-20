# OpenAPI Snippets Generator

CLI tool that generates HTTP code snippets from OpenAPI specifications and injects them into the spec as `x-codeSamples` for documentation renderers like Redoc and Swagger UI.

## Installation

### Global install

```bash
npm install -g .
# or publish to a registry and:
# npm install -g openapi-snippets
```

Then run directly:

```bash
openapi-snippets -i spec.yaml -l 'shell:curl,node:axios,python:requests' --update-spec
```

### Local (project-level)

```bash
npm install
npm run build
node dist/cli.js -i combined.yaml -l 'shell:curl,node:axios,python:requests' --update-spec
```

## Quick Start

```bash
# Inject x-codeSamples into a copy of the spec (combined_updated.yaml)
openapi-snippets -i combined.yaml -l 'shell:curl,node:axios,python:requests' --update-spec

# Target specific operations
openapi-snippets -i combined.yaml -l 'shell:curl,node:axios' \
  --operation-ids 'query_users,create_user' --update-spec
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
  -o, --output <path>         Output directory for manifest/snippets (default: ./generated-snippets)
  --update-spec               Write <input>_updated.<ext> with x-codeSamples injected
  --generate-snippets         Also write individual snippet files to the output directory
  --operation-ids <ids>       Comma-separated operation IDs to include
  --include-tags <tags>       Comma-separated tags to include
  --exclude-tags <tags>       Comma-separated tags to exclude
  --path-regex <regex>        Regex to filter paths
  --methods <methods>         Comma-separated HTTP methods (GET,POST,PUT,DELETE)
  --auth-file <path>          JSON file with auth config
  --server-index <index>      Server index from spec (default: 0)
  --server-vars <vars>        Server variable overrides (key=value,key2=value2)
  -c, --concurrency <n>       Max concurrent operations (default: 10)
  --include-optional          Include optional parameters in snippets
  --dry-run                   List operations without generating snippets
  -v, --verbose               Verbose output
```

## Supported Languages

| Language | Clients |
|----------|---------|
| `shell` | `curl` |
| `node` | `axios`, `native`, `unirest`, `request` |
| `python` | `requests`, `python3` |
| `java` | `okhttp`, `unirest`, `httpcomponents` |
| `go` | `native` |
| `csharp` | `httpclient`, `restsharp` |
| `ruby` | `native`, `net-http` |
| `php` | `curl`, `guzzle` |
| `swift` | `nsurlsession`, `urlsession` |
| `kotlin` | `okhttp` |

## Usage Examples

### Inject code samples into spec

```bash
# All operations, 5 languages
openapi-snippets -i combined.yaml \
  -l 'shell:curl,node:axios,python:requests,go,java:okhttp' \
  --update-spec
# Outputs: combined_updated.yaml
```

### Filter by tags or methods

```bash
openapi-snippets -i combined.yaml \
  -l 'shell:curl,node:axios' \
  --include-tags 'querytimescale_fixed_search' \
  --methods GET,POST \
  --update-spec
```

### Also generate snippet files

```bash
openapi-snippets -i combined.yaml \
  -l 'shell:curl,node:axios' \
  --update-spec \
  --generate-snippets \
  -o ./output
# Produces: ./output/snippets/<operationId>/<lang>-<client>.<ext>
```

### Dry run (list operations)

```bash
openapi-snippets -i combined.yaml -l 'shell' --dry-run
```

### Authentication

Create `auth.json`:
```json
{
  "bearerToken": "your-token-here"
}
```

```bash
openapi-snippets -i openapi.yaml -l 'shell:curl' --auth-file auth.json --update-spec
```

## Output

### Default (`--update-spec` only)

Writes `<input>_updated.<ext>` in the same directory as the input file. The original file is never modified.

### With `--generate-snippets`

```
<output>/
├── manifest.json
└── snippets/
    ├── operation-id-1/
    │   ├── index.json
    │   ├── shell-curl.sh
    │   ├── node-axios.js
    │   └── python-requests.py
    └── ...
```

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

| Code | Meaning |
|------|---------|
| 0 | All snippets generated successfully |
| 1 | Hard failure (parse error, invalid spec) |
| 2 | Partial success (some operations failed) |

## Programmatic Usage

```typescript
import { generate } from './dist/index.js';

const manifest = await generate({
  input: './openapi.yaml',
  output: './snippets',
  languages: [
    { language: 'shell', client: 'curl' },
    { language: 'node', client: 'axios' }
  ],
  filters: { includeTags: ['public'] },
  auth: {},
  server: { index: 0, variables: {} },
  options: {
    concurrency: 10,
    strict: false,
    failOnPartial: true,
    includeOptional: false,
    dryRun: false,
    outputFormat: 'json',
    generateFiles: false,
    updateSpec: true,
  }
});
```

## Technical Details

- **Snippet generation**: `@readme/oas-to-snippet` (primary) with `@readme/oas-to-har` + `@readme/httpsnippet` fallback
- **Spec parsing**: `oas-normalize` + `oas`
- **YAML handling**: `js-yaml`
- **Language target format**: oasToSnippet expects `[language, client]` arrays, not `"lang:client"` strings
- **Spec output format**: `_updated` files preserve the original format (YAML stays YAML, JSON stays JSON)

## License

MIT
