/**
 * Main entry point for OpenAPI snippet generation
 */

import OASNormalize from 'oas-normalize';
import OAS from 'oas';
import oasToHar from '@readme/oas-to-har';
import oasToSnippet from '@readme/oas-to-snippet';
import { HTTPSnippet } from '@readme/httpsnippet';
import { readFile, writeFile } from 'fs/promises';
import { extname, isAbsolute, resolve as resolveFsPath } from 'path';
import yaml from 'js-yaml';
import {
  GenerationConfig,
  OperationDescriptor,
  OperationFilters,
  OperationResult,
  SnippetResult,
  ErrorCode,
  ParameterInfo,
  RequestBodyInfo,
  OpenAPISpec,
  PathItem,
  Operation,
} from './types.js';

interface OASInstance {
  getDefinition: () => OpenAPISpec;
  operation: (path: string, method: string) => unknown;
}

/**
 * Centralized language metadata for extension, label, and client mappings
 */
interface LanguageMeta {
  extension: string;
  label: string;
  clients: readonly string[];
}

const LANGUAGE_METADATA: Readonly<Record<string, LanguageMeta>> = Object.freeze({
  shell: { extension: 'sh', label: 'Shell', clients: ['curl', 'wget'] },
  curl: { extension: 'sh', label: 'cURL', clients: [] },
  node: { extension: 'js', label: 'Node.js', clients: ['axios', 'native', 'unirest', 'request'] },
  python: { extension: 'py', label: 'Python', clients: ['requests', 'fetch', 'python3'] },
  java: { extension: 'java', label: 'Java', clients: ['okhttp', 'unirest', 'httpcomponents'] },
  kotlin: { extension: 'kt', label: 'Kotlin', clients: ['okhttp', 'fuel'] },
  csharp: { extension: 'cs', label: 'C#', clients: ['httpclient', 'restsharp', 'resttemplate'] },
  go: { extension: 'go', label: 'Go', clients: ['native', 'nativehttp'] },
  ruby: { extension: 'rb', label: 'Ruby', clients: ['native', 'net-http'] },
  php: { extension: 'php', label: 'PHP', clients: ['curl', 'guzzle', 'pecl-http'] },
  swift: { extension: 'swift', label: 'Swift', clients: ['nsurlsession', 'urlsession'] },
  c: { extension: 'c', label: 'C', clients: [] },
  objc: { extension: 'm', label: 'Objective-C', clients: [] },
  cpp: { extension: 'cpp', label: 'C++', clients: [] },
  rust: { extension: 'rs', label: 'Rust', clients: [] },
});

/**
 * Main function: parses spec, generates snippets, injects x-codeSamples
 */
export async function generate(config: GenerationConfig): Promise<void> {
  const startTime = Date.now();
  const concurrency = Math.max(1, config.concurrency ?? 8);

  try {
    console.log(`Parsing OpenAPI spec: ${config.input}`);

    const normalizer = new OASNormalize(config.input, { enablePaths: true });
    const dereferencedSpec = await normalizer.dereference();
    const spec = dereferencedSpec as unknown as OpenAPISpec;
    const oasInstance = new OAS(dereferencedSpec as any) as any;

    const specInfo = {
      title: spec.info?.title || 'Untitled API',
      version: spec.info?.version || '0.0.0',
      openapi: (dereferencedSpec as any).openapi || '3.0.0',
    };

    console.log(`Spec: ${specInfo?.title} (${specInfo?.openapi})`);

    const operations = discoverOperations(spec, config.filters);
    console.log(`Found ${operations.length} operations`);
    console.log(`Concurrency: ${concurrency}`);

    // Process operations with bounded concurrency
    const operationResults: OperationResult[] = [];
    const settled = await mapWithConcurrency(operations, concurrency, (op) =>
      processOperation(op, config, oasInstance, spec)
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        operationResults.push(result.value);
      } else {
        console.error(`Operation failed: ${result.reason}`);
      }
    }

    // Inject x-codeSamples into spec
    await updateSpecWithSnippets(config.input, operationResults);

    // Print summary
    let snippetSuccess = 0;
    let snippetFailed = 0;
    let snippetSkipped = 0;
    for (const o of operationResults) {
      snippetSuccess += o.successCount;
      snippetFailed += o.failureCount;
      snippetSkipped += o.skipCount;
    }
    const duration = Date.now() - startTime;
    console.log(`\n=== Done ===`);
    console.log(`Operations: ${operationResults.length}/${operations.length}`);
    console.log(
      `Snippets: ${snippetSuccess} generated, ${snippetFailed} failed, ${snippetSkipped} skipped`
    );
    console.log(`Duration: ${duration}ms`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Generation failed: ${errorMessage}`, { cause: error });
  }
}

/**
 * Process a list with a configurable concurrency limit while preserving order.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (items.length === 0) return [];

  const maxWorkers = Math.min(Math.max(1, concurrency), items.length);
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) return;

      try {
        const value = await mapper(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: maxWorkers }, () => worker()));
  return results;
}

/**
 * Discover operations from OpenAPI spec
 */
function discoverOperations(spec: OpenAPISpec, filters: OperationFilters): OperationDescriptor[] {
  const operations: OperationDescriptor[] = [];
  const paths = spec.paths || {};
  const pathRegex = filters.pathRegex ? new RegExp(filters.pathRegex) : undefined;

  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation = (pathItem as PathItem)[method as keyof PathItem] as Operation | undefined;

      if (!operation) continue;

      // Get operationId or generate fallback
      const operationId = operation.operationId || generateFallbackOperationId(method, path);

      // Apply filters
      if (filters.operationIds && filters.operationIds.length > 0) {
        if (!filters.operationIds.includes(operationId)) continue;
      }

      if (filters.includeTags && filters.includeTags.length > 0) {
        const opTags = operation.tags || [];
        if (!opTags.some((t: string) => filters.includeTags!.includes(t))) continue;
      }

      if (filters.excludeTags && filters.excludeTags.length > 0) {
        const opTags = operation.tags || [];
        if (opTags.some((t: string) => filters.excludeTags!.includes(t))) continue;
      }

      if (pathRegex && !pathRegex.test(path)) continue;

      if (filters.methods && !filters.methods.includes(method.toUpperCase())) continue;

      // Extract parameters
      const parameters = extractParameters(operation, pathItem as PathItem);

      // Extract request body
      const requestBodyInfo = extractRequestBody(operation);

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary,
        description: operation.description,
        tags: operation.tags || [],
        security: operation.security || spec.security || [],
        requestBodyInfo,
        parameters,
        deprecated: operation.deprecated || false,
      });
    }
  }

  return operations;
}

/**
 * Generate fallback operation ID
 */
function generateFallbackOperationId(method: string, path: string): string {
  const normalizedPath = path
    .replace(/\{/g, '_')
    .replace(/\}/g, '_')
    .replace(/\//g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  return `${method.toLowerCase()}_${normalizedPath}`;
}

/**
 * Extract parameters from operation
 */
function extractParameters(operation: Operation, pathItem: PathItem): ParameterInfo[] {
  const mergedParams = new Map<string, ParameterInfo>();
  const pathLevelParams = pathItem.parameters || [];
  const operationLevelParams = operation.parameters || [];
  const allParams = [...pathLevelParams, ...operationLevelParams];

  for (const param of allParams) {
    const schema = param.schema as Record<string, unknown> | undefined;
    const key = `${param.in}:${param.name}`;

    // Operation-level parameters naturally override path-level ones by insertion order.
    mergedParams.set(key, {
      name: param.name,
      in: param.in,
      required: param.required || false,
      schema: param.schema || param,
      example: param.example ?? schema?.example,
      default: schema?.default,
      description: param.description,
    });
  }

  return Array.from(mergedParams.values());
}

/**
 * Resolve parameter value with nullish checks to preserve falsy examples/defaults.
 */
function resolveParameterValue(param: ParameterInfo): unknown {
  const schema = param.schema as Record<string, unknown> | undefined;
  return param.example ?? param.default ?? generatePrimitiveExample(schema ?? {});
}

/**
 * Return a parameter key exactly as used in the `values` object.
 */
function getParameterKey(name: string): string {
  return name.replace(/[{}]/g, '');
}

/**
 * Extract request body info
 */
function extractRequestBody(operation: Operation): RequestBodyInfo | undefined {
  const requestBody = operation.requestBody;

  if (!requestBody) return undefined;

  const content = requestBody.content || {};
  const contentType = Object.keys(content)[0] || 'application/json';
  const mediaType = content[contentType] || {};

  return {
    required: requestBody.required || false,
    contentType,
    schema: mediaType.schema,
    example: mediaType.example,
    examples: mediaType.examples,
  };
}

/**
 * Process a single operation
 */
async function processOperation(
  op: OperationDescriptor,
  config: GenerationConfig,
  oas: OASInstance,
  spec: OpenAPISpec
): Promise<OperationResult> {
  const operationKey = createOperationKey(op);
  const snippets: SnippetResult[] = [];

  // Build request values for HAR generation
  const values = buildRequestValues(op, config);

  // Process snippets sequentially per operation to keep global concurrency bounded.
  for (const langConfig of config.languages) {
    const snippet = await generateSnippet(operationKey, op, langConfig, oas, spec, values, config);
    snippets.push(snippet);
  }

  const successCount = snippets.filter((s) => !s.error && s.code).length;
  const failureCount = snippets.filter((s) => s.error).length;
  const skipCount = snippets.filter((s) => !s.error && !s.code).length;

  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    snippets,
    successCount,
    failureCount,
    skipCount,
  };
}

/**
 * Create operation key string
 */
function createOperationKey(op: OperationDescriptor): string {
  return op.operationId || `${op.method.toLowerCase()}_${op.path.replace(/[/{}]/g, '_')}`;
}

/**
 * Build request values for HAR generation
 */
function buildRequestValues(op: OperationDescriptor, config: GenerationConfig): any {
  const values: any = {
    path: {},
    query: {},
    header: {},
    cookie: {},
  };

  // Set auth placeholders
  if (config.auth.bearerToken) {
    values.header = values.header || {};
    values.header['Authorization'] = `Bearer ${config.auth.bearerToken}`;
  } else if (config.auth.apiKey) {
    values.header = values.header || {};
    values.header['X-API-Key'] = config.auth.apiKey;
  } else if (config.auth.basicAuth) {
    values.header = values.header || {};
    values.header['Authorization'] =
      `Basic ${Buffer.from(`${config.auth.basicAuth.username}:${config.auth.basicAuth.password}`).toString('base64')}`;
  }

  // Process parameters
  for (const param of op.parameters) {
    const paramKey = getParameterKey(param.name);
    const value = resolveParameterValue(param);

    if (param.in === 'path') {
      values.path[paramKey] = value;
    } else if (param.in === 'query') {
      values.query[paramKey] = value;
    } else if (param.in === 'header') {
      values.header[paramKey] = value;
    } else if (param.in === 'cookie') {
      values.cookie[paramKey] = value;
    }
  }

  // Handle required-only filter
  if (!config.includeOptional) {
    for (const param of op.parameters) {
      if (!param.required) {
        const paramKey = getParameterKey(param.name);
        if (param.in === 'query') {
          delete values.query[paramKey];
        } else if (param.in === 'header') {
          delete values.header[paramKey];
        } else if (param.in === 'cookie') {
          delete values.cookie[paramKey];
        }
      }
    }
  }

  // Add request body if present
  if (op.requestBodyInfo) {
    values.body = op.requestBodyInfo.example ?? extractExampleFromSchema(op.requestBodyInfo.schema);
  }

  // Set server configuration
  values.server = {
    selected: config.server.index,
    variables: config.server.variables,
  };

  return values;
}

/**
 * Extract example value from schema (consolidated function for primitives and complex types)
 */
function extractExampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return undefined;

  const s = schema as Record<string, unknown>;

  // Priority: example > default > generate from structure
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;

  if (s.type === 'object' && s.properties) {
    const obj: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(s.properties as Record<string, unknown>)) {
      obj[key] = extractExampleFromSchema(propSchema);
    }
    return obj;
  }

  if (s.type === 'array' && s.items) {
    return [extractExampleFromSchema(s.items)];
  }

  // Generate primitive examples
  return generatePrimitiveExample(s);
}

/**
 * Generate example value for primitive types
 */
function generatePrimitiveExample(schema: Record<string, unknown>): unknown {
  const { type, format } = schema;
  const enumValues = schema.enum as unknown[] | undefined;

  switch (type) {
    case 'string':
      if (enumValues?.length) return String(enumValues[0]);
      switch (format) {
        case 'uuid':
          return '00000000-0000-0000-0000-000000000000';
        case 'date-time':
          return '2024-01-01T00:00:00Z';
        case 'date':
          return '2024-01-01';
        case 'email':
          return 'example@example.com';
        case 'uri':
          return 'https://example.com';
        default:
          return '<string>';
      }
    case 'integer':
    case 'number':
      if (typeof schema.minimum === 'number') return schema.minimum;
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return '<example>';
  }
}

// Supported language/client combinations
const SUPPORTED_LANGUAGES = [
  'shell',
  'node',
  'python',
  'java',
  'csharp',
  'go',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'c',
  'curl',
];

/**
 * Generate snippet for operation+language
 */
async function generateSnippet(
  operationKey: string,
  op: OperationDescriptor,
  langConfig: { language: string; client: string | undefined },
  oas: OASInstance,
  spec: OpenAPISpec,
  values: Record<string, unknown>,
  config: GenerationConfig
): Promise<SnippetResult> {
  const warnings: string[] = [];

  // Validate language support
  if (!SUPPORTED_LANGUAGES.includes(langConfig.language.toLowerCase())) {
    return createUnsupportedLanguageError(operationKey, langConfig);
  }

  // Try oas-to-snippet first (preferred high-level path)
  try {
    // Get OAS Operation object from path and method
    const oasOperation = oas.operation(op.path, op.method.toLowerCase());

    // Build the language target (oasToSnippet expects [language, client] or just language)
    const langTarget = langConfig.client
      ? [langConfig.language, langConfig.client]
      : langConfig.language;

    const snippetResult = await oasToSnippet(
      oas as any,
      oasOperation as any,
      values,
      {},
      langTarget as any
    );

    const code = snippetResult.code || '';
    const highlightMode = snippetResult.highlightMode || undefined;

    if (code && code.length > 0) {
      return {
        operationKey,
        language: langConfig.language,
        client: langConfig.client,
        code,
        highlightMode,
        warnings,
        error: undefined,
      };
    }
  } catch (snippetError) {
    warnings.push(
      'oasToSnippet failed: ' +
        (snippetError instanceof Error ? snippetError.message : String(snippetError))
    );
  }

  // Fallback: HAR generation + HTTPSnippet
  try {
    const oasOperation = oas.operation(op.path, op.method.toLowerCase());
    const harResult = await oasToHar(oas as any, oasOperation as any, values, {});

    // Extract request from HAR log entries
    const harRequest = harResult.log?.entries?.[0]?.request;

    if (harRequest) {
      // Build a proper HTTPSnippet-compatible request
      const snippet = new HTTPSnippet({
        method: harRequest.method || op.method,
        url: harRequest.url || buildUrlFromSpec(op, spec, config),
        headers: (harRequest.headers || []).map((h: any) => ({ name: h.name, value: h.value })),
        queryString: (harRequest.queryString || []).map((q: any) => ({
          name: q.name,
          value: q.value,
        })),
        postData: harRequest.postData,
      } as any);

      const converted = snippet.convert(langConfig.language as any, langConfig.client as any);
      const code = converted.filter((c): c is string => c !== false).join('\n') || '';

      if (code) {
        return {
          operationKey,
          language: langConfig.language,
          client: langConfig.client,
          code,
          highlightMode: langConfig.language,
          warnings,
          error: undefined,
        };
      }
    }
  } catch (harError) {
    warnings.push(
      'oasToHar/HTTPSnippet failed: ' +
        (harError instanceof Error ? harError.message : String(harError))
    );
  }

  return createSnippetGenerationError(operationKey, langConfig, warnings);
}

/**
 * Create error for unsupported language
 */
function createUnsupportedLanguageError(
  operationKey: string,
  langConfig: { language: string; client: string | undefined }
): SnippetResult {
  return {
    operationKey,
    language: langConfig.language,
    client: langConfig.client,
    code: '',
    highlightMode: undefined,
    warnings: [],
    error: {
      code: ErrorCode.E_UNSUPPORTED_LANGUAGE,
      message: `Language '${langConfig.language}' is not supported`,
      remediation: `Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`,
    },
  };
}

/**
 * Create error when snippet generation fails across all generation paths.
 */
function createSnippetGenerationError(
  operationKey: string,
  langConfig: { language: string; client: string | undefined },
  warnings: string[]
): SnippetResult {
  const remediationDetail =
    warnings.length > 0
      ? `Generation attempts failed: ${warnings.join(' | ')}`
      : 'No code snippet could be generated for this operation/language pair.';

  return {
    operationKey,
    language: langConfig.language,
    client: langConfig.client,
    code: '',
    highlightMode: undefined,
    warnings,
    error: {
      code: ErrorCode.E_SNIPPET_GENERATION_FAILED,
      message: `Failed to generate snippet for language '${langConfig.language}'`,
      remediation: remediationDetail,
    },
  };
}

/**
 * Build URL from spec
 */
function buildUrlFromSpec(
  op: OperationDescriptor,
  spec: OpenAPISpec,
  config: GenerationConfig
): string {
  let baseUrl = 'https://api.example.com';

  // Try to get server from spec
  const servers = spec.servers || [];
  if (servers.length > 0) {
    const server = servers[config.server.index] || servers[0];
    baseUrl = server.url || baseUrl;

    // Replace server variables
    if (server.variables) {
      for (const [key, varDef] of Object.entries(server.variables)) {
        const variable = varDef as { default?: string };
        const value = config.server.variables[key] ?? variable.default ?? '';
        baseUrl = baseUrl.replace(`{${key}}`, value);
      }
    }
  }

  // Replace path parameters
  let path = op.path;
  for (const param of op.parameters) {
    if (param.in === 'path') {
      const value = String(resolveParameterValue(param));
      path = path.replace(`{${param.name}}`, encodeURIComponent(value));
    }
  }

  return `${baseUrl}${path}`;
}

/**
 * Update the OpenAPI spec with generated x-codeSamples (writes to a _updated copy)
 */
async function updateSpecWithSnippets(
  inputPath: string,
  operationResults: OperationResult[]
): Promise<void> {
  // Resolve the file path (handle URLs by skipping)
  if (inputPath.startsWith('http://') || inputPath.startsWith('https://')) {
    console.warn('Cannot update remote spec - skipping x-codeSamples injection');
    return;
  }

  const absPath = resolvePath(inputPath);
  const raw = await readFile(absPath, 'utf-8');
  const ext = extname(absPath).toLowerCase();

  // Parse: YAML or JSON
  let spec: Record<string, unknown>;
  if (ext === '.yaml' || ext === '.yml') {
    spec = yaml.load(raw) as Record<string, unknown>;
  } else if (ext === '.json') {
    spec = JSON.parse(raw);
  } else {
    console.warn(`Unknown spec format '${ext}' - skipping x-codeSamples injection`);
    return;
  }

  const openapiSpec = spec as OpenAPISpec;
  if (!openapiSpec.paths || typeof openapiSpec.paths !== 'object') {
    console.warn('No paths found in spec - skipping x-codeSamples injection');
    return;
  }

  // Build a lookup map: "METHOD /path" -> OperationResult
  const resultMap = new Map<string, OperationResult>();
  for (const result of operationResults) {
    resultMap.set(`${result.method.toUpperCase()} ${result.path}`, result);
  }

  // Helper: map snippet language to display label using centralized metadata
  function languageLabel(lang: string, client?: string): string {
    const meta = LANGUAGE_METADATA[lang];
    if (client) {
      return `${meta?.label || lang} (${client})`;
    }
    return meta?.label || lang;
  }

  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
  let totalSamples = 0;

  for (const [path, pathItem] of Object.entries(openapiSpec.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of httpMethods) {
      const operation = (pathItem as PathItem)[method as keyof PathItem] as Operation | undefined;
      if (!operation || typeof operation !== 'object') continue;

      const key = `${method.toUpperCase()} ${path}`;
      const result = resultMap.get(key);
      if (!result) continue;

      // Build x-codeSamples from successful snippets
      const codeSamples: Array<{ lang: string; label: string; source: string }> = [];

      for (const snippet of result.snippets) {
        if (snippet.error || !snippet.code) continue;

        codeSamples.push({
          lang: languageLabel(snippet.language, snippet.client),
          label: snippet.client ? `${snippet.language}-${snippet.client}` : snippet.language,
          source: snippet.code,
        });
      }

      if (codeSamples.length > 0) {
        operation['x-codeSamples'] = codeSamples;
        totalSamples += codeSamples.length;
      }
    }
  }

  // Serialize back to the original format
  let output: string;
  if (ext === '.yaml' || ext === '.yml') {
    output = yaml.dump(spec, {
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
      forceQuotes: false,
    });
  } else {
    output = JSON.stringify(spec, null, 2) + '\n';
  }

  // Build output path: combined.yaml -> combined_updated.yaml
  const dotIdx = absPath.lastIndexOf('.');
  const lastSep = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  const stem = dotIdx > lastSep ? absPath.slice(lastSep + 1, dotIdx) : absPath.slice(lastSep + 1);
  const outExt = dotIdx > lastSep ? absPath.slice(dotIdx) : '';
  const dir = lastSep >= 0 ? absPath.slice(0, lastSep + 1) : '';
  const outPath = `${dir}${stem}_updated${outExt}`;

  await writeFile(outPath, output);
  console.log(
    `\nWrote ${outPath} with ${totalSamples} x-codeSamples across ${operationResults.length} operations`
  );
}

/**
 * Resolve a possibly-relative path to an absolute path
 */
function resolvePath(inputPath: string): string {
  if (isAbsolute(inputPath)) return inputPath;
  return resolveFsPath(process.cwd(), inputPath);
}

// Export for programmatic use
export { GenerationConfig } from './types.js';
export { ErrorCode } from './types.js';
