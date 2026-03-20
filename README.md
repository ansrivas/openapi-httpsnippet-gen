# OpenAPI Snippets Generator

A powerful CLI tool that generates HTTP code snippets from OpenAPI specifications for multiple programming languages and HTTP clients.

## Overview

This tool takes an OpenAPI YAML/JSON specification and generates ready-to-use request code snippets for each endpoint. It supports multiple languages and HTTP clients, making it easy to provide developer-friendly examples in documentation.

## Features

- **Multi-language support**: Generate snippets for shell (curl), Node.js (axios, fetch), Python (requests), and more
- **Flexible filtering**: Include/exclude endpoints by tags, methods, path regex, or operation IDs
- **Configurable concurrency**: Process multiple operations in parallel for faster generation
- **Rich output formats**: Generate structured JSON manifest and individual snippet files
- **Authentication handling**: Support for API keys, bearer tokens, and basic auth
- **Dry run mode**: Preview operations without generating snippets
- **CI-friendly**: Deterministic output and configurable exit codes

## Installation

```bash
npm install
npm run build
```

## Quick Start

```bash
node dist/cli.js --input ./openapi.yaml --languages shell,node:axios,python --output ./snippets
```

## CLI Usage

```bash
openapi-snippets generate [options]

Required Options:
  -i, --input <path>        OpenAPI file path or URL
  -l, --languages <list>    Comma-separated list of languages (e.g., shell,node:axios,python:requests)

Optional Options:
  -o, --output <path>       Output directory (default: ./generated-snippets)
  -f, --format <format>     Output format: json or markdown (default: json)
  --operation-ids <ids>     Comma-separated operation IDs to include
  --include-tags <tags>     Comma-separated tags to include
  --exclude-tags <tags>     Comma-separated tags to exclude
  --path-regex <regex>      Regex to filter paths
  --methods <methods>       Comma-separated HTTP methods to include (GET,POST,PUT,DELETE)
  --auth-file <path>        JSON file with authentication config
  --server-index <index>    Server index to use from spec
  --server-vars <vars>      Server variable overrides (key=value,key2=value2)
  -c, --concurrency <n>     Max concurrent operations (default: 10)
  --strict                  Fail on any per-operation/language failure
  --fail-on-partial         Fail on partial success (default: true)
  --include-optional        Include optional parameters in snippets
  --dry-run                 Parse and list operations without generating snippets
  -v, --verbose             Verbose output
```

## Supported Languages and Clients

### Languages
- `shell` - cURL commands
- `node` - Node.js HTTP
- `python` - Python requests
- `java` - Java HTTP clients
- `csharp` - C# HTTP clients
- `go` - Go HTTP clients
- `ruby` - Ruby HTTP clients
- `php` - PHP HTTP clients
- `swift` - Swift HTTP clients

### Clients by Language
- **Node.js**: `axios`, `native`, `unirest`, `request`
- **Python**: `requests`, `python3`, `fetch`
- **Java**: `okhttp`, `unirest`, `httpcomponents`
- **C#**: `httpclient`, `restsharp`, `resttemplate`
- **Go**: `native`, `nativehttp`
- **Ruby**: `native`, `net-http`
- **PHP**: `curl`, `guzzle`, `pecl-http`
- **Swift**: `nsurlsession`, `urlsession`
- **Shell**: `curl`, `wget`

## Examples

### Basic Usage
```bash
node dist/cli.js --input ./combined.yaml --languages shell,node:axios,python --output ./snippets
```

### Filter by Tags
```bash
node dist/cli.js --input ./combined.yaml --languages shell --include-tags querytimescale_fixed_timeseries
```

### Multiple Languages with Specific Operations
```bash
node dist/cli.js --input ./combined.yaml \
  --languages shell,node:axios,python,java:okhttp \
  --operation-ids query_timeseries_api_v2_tsdata_ns__namespace__ts__ts_uuid__get \
  --output ./snippets
```

### Filter by HTTP Methods
```bash
node dist/cli.js --input ./combined.yaml --languages shell --methods GET,POST
```

### Dry Run (Preview Operations)
```bash
node dist/cli.js --input ./combined.yaml --languages shell --dry-run
```

### High Performance with Concurrency
```bash
node dist/cli.js --input ./combined.yaml --languages shell,node,python --concurrency 20
```

## Authentication

Create an auth config file (`auth.json`):
```json
{
  "apiKey": "your-api-key-here",
  "bearerToken": "your-bearer-token-here"
}
```

Use it with:
```bash
node dist/cli.js --input ./openapi.yaml --languages shell --auth-file ./auth.json
```

## Output Structure

The tool generates the following output:

```
generated-snippets/
├── manifest.json                           # Full structured manifest
└── snippets/
    ├── operation-id-1/
    │   ├── index.json                      # Operation metadata
    │   ├── shell.sh                        # Shell snippet
    │   ├── node-axios.js                   # Node.js with Axios
    │   └── python.py                       # Python snippet
    ├── operation-id-2/
    │   └── ...
    └── ...
```

### Manifest Structure
```json
{
  "metadata": {
    "input": "./openapi.yaml",
    "output": "./generated-snippets",
    "languages": ["shell", "node:axios", "python"],
    "generatedAt": "2024-01-01T00:00:00.000Z",
    "durationMs": 115,
    "specInfo": {
      "title": "My API",
      "version": "1.0.0",
      "openapi": "3.1.0"
    }
  },
  "totals": {
    "operationsTotal": 113,
    "operationsProcessed": 113,
    "snippetsSuccess": 339,
    "snippetsFailed": 0,
    "snippetsSkipped": 0
  },
  "operations": [
    {
      "operationId": "query_users",
      "method": "GET",
      "path": "/api/v1/users",
      "snippets": [...],
      "successCount": 3,
      "failureCount": 0,
      "skipCount": 0
    }
  ],
  "unresolvedIssues": []
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `E_PARSE_INVALID_SPEC` | OpenAPI spec parsing/validation failed |
| `E_UNSUPPORTED_LANGUAGE` | Requested language is not supported |
| `E_UNSUPPORTED_CLIENT` | Requested client for language is not supported |
| `E_OPERATION_BUILD_FAILED` | Failed to build operation from spec |
| `E_SNIPPET_GENERATION_FAILED` | Failed to generate snippet |
| `E_OUTPUT_WRITE_FAILED` | Failed to write output files |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all snippets generated |
| 1 | Hard failure (parse error, etc.) |
| 2 | Partial success (some operations failed) |

## Technical Stack

- **Parsing**: `oas-normalize` for OpenAPI spec normalization
- **Operation traversal**: `oas` library for operation handling
- **HAR generation**: `@readme/oas-to-har` for HTTP Archive format
- **Snippet generation**: `@readme/oas-to-snippet` with `httpsnippet` fallback

## Programmatic Usage

```typescript
import { generate, GenerationConfig } from './dist/index.js';

const config: GenerationConfig = {
  input: './openapi.yaml',
  output: './snippets',
  languages: [
    { language: 'shell', client: undefined },
    { language: 'node', client: 'axios' }
  ],
  filters: {
    includeTags: ['public'],
    methods: ['GET', 'POST']
  },
  auth: {
    bearerToken: '<TOKEN>'
  },
  server: {
    index: 0,
    variables: {}
  },
  options: {
    concurrency: 10,
    strict: false,
    failOnPartial: true,
    includeOptional: false,
    dryRun: false,
    outputFormat: 'json',
    generateFiles: true
  }
};

const manifest = await generate(config);
console.log(`Generated ${manifest.totals.snippetsSuccess} snippets`);
```

## Testing

Run the tool against the included `combined.yaml` test file:

```bash
# Dry run to list all operations
node dist/cli.js --input ./combined.yaml --languages shell --dry-run

# Generate snippets for specific tags
node dist/cli.js --input ./combined.yaml \
  --languages shell,node:axios,python \
  --include-tags querytimescale_fixed_timeseries \
  --output ./test-output

# Full generation (all 113 operations)
node dist/cli.js --input ./combined.yaml \
  --languages shell,node:axios,python \
  --output ./test-output-full \
  --concurrency 10
```

## Performance

Processing the combined.yaml spec (113 operations):
- **Total snippets**: 339 (3 languages × 113 operations)
- **Processing time**: ~115ms with concurrency of 10
- **Memory usage**: Minimal, processes operations in chunks

## License

MIT
