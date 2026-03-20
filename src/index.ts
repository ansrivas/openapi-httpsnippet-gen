/**
 * Main entry point for OpenAPI snippet generation
 */

import OASNormalize from 'oas-normalize';
import OAS from 'oas';
import oasToHar from '@readme/oas-to-har';
import oasToSnippet from '@readme/oas-to-snippet';
import { HTTPSnippet } from 'httpsnippet';
import { mkdir, writeFile, access, constants } from 'fs/promises';
import { dirname, join } from 'path';
import {
  GenerationConfig,
  GenerationManifest,
  GenerationTotals,
  ManifestMetadata,
  OperationDescriptor,
  OperationFilters,
  OperationResult,
  SnippetResult,
  UnresolvedIssue,
  ErrorCode,
  ParameterInfo,
  RequestBodyInfo
} from './types.js';

interface OASInstance {
  getDefinition: () => any;
  operation: (path: string, method: string) => any;
  findOperation: (operationId: string) => any;
}

// Cache for OAS instance
let cachedOAS: OASInstance | null = null;
let cachedSpec: any = null;

/**
 * Main generation function
 */
export async function generate(config: GenerationConfig): Promise<GenerationManifest> {
  const startTime = Date.now();
  const issues: UnresolvedIssue[] = [];
  const operationResults: OperationResult[] = [];
  
  try {
    // Parse and validate OpenAPI spec
    console.log(`Parsing OpenAPI spec: ${config.input}`);
    
    const normalizer = new OASNormalize(config.input, { enablePaths: true });
    const spec = await normalizer.dereference();
    cachedSpec = spec;
    
    // Create OAS instance for library compatibility
    const oasInstance = new OAS(spec as any) as any;
    cachedOAS = oasInstance;
    
    // Extract spec metadata
    const specInfo = {
      title: spec.info?.title || 'Untitled API',
      version: spec.info?.version || '0.0.0',
      openapi: (spec as any).openapi || '3.0.0'
    };
    
    console.log(`Spec: ${specInfo?.title} (${specInfo?.openapi})`);
    
    // Discover operations
    const operations = discoverOperations(spec, config.filters);
    console.log(`Found ${operations.length} operations`);
    
    if (config.options.dryRun) {
      console.log('\nDry run - listing operations:');
      for (const op of operations) {
        console.log(`  ${op.method.toUpperCase()} ${op.path} (${op.operationId})`);
      }
      return createMinimalManifest(config, startTime, specInfo, operations.length);
    }
    
    // Ensure output directory exists
    await ensureDirectory(config.output);
    
    // Process operations with concurrency limit
    const chunks = chunkArray(operations, config.options.concurrency);
    
    for (const chunk of chunks) {
      const promises = chunk.map(op => processOperation(op, config, oasInstance, spec, issues));
      const results = await Promise.all(promises);
      operationResults.push(...results);
    }
    
    // Calculate totals
    const totals = calculateTotals(operationResults);
    
    // Create manifest
    const manifest: GenerationManifest = {
      metadata: createMetadata(config, startTime, specInfo),
      totals,
      operations: operationResults,
      unresolvedIssues: issues
    };
    
    // Write manifest
    const manifestPath = join(config.output, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written to: ${manifestPath}`);
    
    // Generate output files if requested
    if (config.options.generateFiles) {
      await generateOutputFiles(operationResults, config);
    }
    
    return manifest;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Generation failed: ${errorMessage}`);
  }
}

/**
 * Discover operations from OpenAPI spec
 */
function discoverOperations(spec: any, filters: OperationFilters): OperationDescriptor[] {
  const operations: OperationDescriptor[] = [];
  const paths = spec.paths || {};
  
  const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
  
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation = (pathItem as any)[method];
      
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
      
      if (filters.pathRegex && !filters.pathRegex.test(path)) continue;
      
      if (filters.methods && !filters.methods.includes(method.toUpperCase())) continue;
      
      // Extract parameters
      const parameters = extractParameters(operation, pathItem as any);
      
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
        deprecated: operation.deprecated || false
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
function extractParameters(operation: any, pathItem: any): ParameterInfo[] {
  const params: ParameterInfo[] = [];
  
  // Path-level parameters
  const pathParams = (pathItem.parameters || []).filter((p: any) => p.in === 'path');
  
  // Operation-level parameters
  const opParams = operation.parameters || [];
  
  const allParams = [...pathParams, ...opParams];
  
  for (const param of allParams) {
    params.push({
      name: param.name,
      in: param.in,
      required: param.required || false,
      schema: param.schema || param,
      example: param.example ?? param.schema?.example,
      default: param.schema?.default ?? param.default,
      description: param.description
    });
  }
  
  return params;
}

/**
 * Extract request body info
 */
function extractRequestBody(operation: any): RequestBodyInfo | undefined {
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
    examples: mediaType.examples
  };
}

/**
 * Process a single operation
 */
async function processOperation(
  op: OperationDescriptor,
  config: GenerationConfig,
  oas: OASInstance,
  spec: any,
  issues: UnresolvedIssue[]
): Promise<OperationResult> {
  const operationKey = createOperationKey(op);
  const snippets: SnippetResult[] = [];
  
  // Build request values for HAR generation
  const values = buildRequestValues(op, config);
  
  // Process each requested language
  for (const langConfig of config.languages) {
    const result = await generateSnippet(operationKey, op, langConfig, oas, spec, values, config);
    snippets.push(result);
    
    if (result.error) {
      issues.push({
        operationId: op.operationId,
        code: result.error.code,
        message: result.error.message
      });
    }
  }
  
  const successCount = snippets.filter(s => !s.error && s.code).length;
  const failureCount = snippets.filter(s => s.error).length;
  const skipCount = snippets.filter(s => !s.error && !s.code).length;
  
  return {
    operationId: op.operationId,
    method: op.method,
    path: op.path,
    snippets,
    successCount,
    failureCount,
    skipCount
  };
}

/**
 * Create operation key string
 */
function createOperationKey(op: OperationDescriptor): string {
  return op.operationId || `${op.method.toLowerCase()}_${op.path.replace(/[\/{}]/g, '_')}`;
}

/**
 * Build request values for HAR generation
 */
function buildRequestValues(op: OperationDescriptor, config: GenerationConfig): any {
  const values: any = {
    path: {},
    query: {},
    header: {},
    cookie: {}
  };
  
  // Set auth placeholders
  if (config.auth.bearerToken) {
    values.header = values.header || {};
    values.header['Authorization'] = `Bearer ${config.auth.bearerToken}`;
  } else if (config.auth.apiKey) {
    values.header = values.header || {};
    values.header['X-API-Key'] = '<API_KEY>';
  } else if (config.auth.basicAuth) {
    values.header = values.header || {};
    values.header['Authorization'] = `Basic ${Buffer.from(`${config.auth.basicAuth.username}:${config.auth.basicAuth.password}`).toString('base64')}`;
  }
  
  // Process parameters
  for (const param of op.parameters) {
    const paramName = param.name.replace(/[{}]/g, '');
    const schema = param.schema as Record<string, any> | undefined;
    const value = param.example || param.default || generateExampleValue(schema);
    
    if (param.in === 'path') {
      values.path[paramName] = value;
    } else if (param.in === 'query') {
      values.query[paramName] = value;
    } else if (param.in === 'header') {
      values.header[paramName] = value;
    } else if (param.in === 'cookie') {
      values.cookie[paramName] = value;
    }
  }
  
  // Handle required-only filter
  if (!config.options.includeOptional) {
    for (const param of op.parameters) {
      if (!param.required) {
        if (param.in === 'query') {
          delete values.query[param.name];
        } else if (param.in === 'header') {
          delete values.header[param.name];
        }
      }
    }
  }
  
  // Add request body if present
  if (op.requestBodyInfo) {
    values.body = op.requestBodyInfo.example || generateExampleFromSchema(op.requestBodyInfo.schema);
  }
  
  // Set server configuration
  values.server = {
    selected: config.server.index,
    variables: config.server.variables
  };
  
  return values;
}

/**
 * Generate example value based on schema
 */
function generateExampleValue(schema: Record<string, any> | undefined): string {
  if (!schema) return '<example>';
  
  // Check for common formats
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);
  
  // Generate based on type
  switch (schema.type) {
    case 'string':
      if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
      if (schema.format === 'date') return '2024-01-01';
      if (schema.format === 'email') return 'example@example.com';
      if (schema.format === 'uri') return 'https://example.com';
      if (schema.enum && schema.enum.length > 0) return String(schema.enum[0]);
      return '<string>';
    case 'integer':
    case 'number':
      if (schema.minimum !== undefined) return String(schema.minimum);
      return '0';
    case 'boolean':
      return 'true';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    default:
      return '<example>';
  }
}

/**
 * Generate example from schema
 */
function generateExampleFromSchema(schema: any): any {
  if (!schema) return {};
  
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  
  if (schema.type === 'object' && schema.properties) {
    const obj: Record<string, any> = {};
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      obj[key] = generateExampleFromSchema(propSchema as any);
    }
    return obj;
  }
  
  if (schema.type === 'array' && schema.items) {
    return [generateExampleFromSchema(schema.items)];
  }
  
  return generateExampleValue(schema);
}

// Supported language/client combinations
const SUPPORTED_LANGUAGES = ['shell', 'node', 'python', 'java', 'csharp', 'go', 'ruby', 'php', 'swift', 'kotlin', 'c', 'curl'];

/**
 * Generate snippet for operation+language
 */
async function generateSnippet(
  operationKey: string,
  op: OperationDescriptor,
  langConfig: { language: string; client: string | undefined },
  oas: OASInstance,
  spec: any,
  values: any,
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
    
    // Build the language target (e.g., "node:axios" or just "shell")
    const langTarget = langConfig.client 
      ? `${langConfig.language}:${langConfig.client}`
      : langConfig.language;
    
    const snippetResult = await oasToSnippet(
      oas as any,
      oasOperation,
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
        error: undefined
      };
    }
  } catch (snippetError) {
    // Continue to fallback
  }
  
  // Fallback: HAR generation + HTTPSnippet
  try {
    const oasOperation = oas.operation(op.path, op.method.toLowerCase());
    const harResult = await oasToHar(oas as any, oasOperation, values, {});
    
    // Extract request from HAR log entries
    const harRequest = harResult.log?.entries?.[0]?.request;
    
    if (harRequest) {
      // Build a proper HTTPSnippet-compatible request
      const snippet = new HTTPSnippet({
        method: harRequest.method || op.method,
        url: harRequest.url || buildUrlFromSpec(op, spec, config),
        headers: (harRequest.headers || []).map((h: any) => ({ name: h.name, value: h.value })),
        queryString: (harRequest.queryString || []).map((q: any) => ({ name: q.name, value: q.value })),
        postData: harRequest.postData
      } as any);
      
      const code = snippet.convert(langConfig.language as any, langConfig.client as any) as string || '';
      
      if (code) {
        return {
          operationKey,
          language: langConfig.language,
          client: langConfig.client,
          code,
          highlightMode: langConfig.language,
          warnings,
          error: undefined
        };
      }
    }
  } catch (harError) {
    // HAR generation failed, continue
  }
  
  // Generate a basic placeholder snippet
  const placeholderCode = generatePlaceholderSnippet(op, langConfig);
  warnings.push('Generated placeholder snippet - operation may have invalid parameters');
  
  return {
    operationKey,
    language: langConfig.language,
    client: langConfig.client,
    code: placeholderCode,
    highlightMode: langConfig.language,
    warnings,
    error: undefined
  };
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
      remediation: `Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`
    }
  };
}

/**
 * Build URL from spec
 */
function buildUrlFromSpec(op: OperationDescriptor, spec: any, config: GenerationConfig): string {
  let baseUrl = 'https://api.example.com';
  
  // Try to get server from spec
  const servers = spec.servers || [];
  if (servers.length > 0) {
    const server = servers[config.server.index] || servers[0];
    baseUrl = server.url || baseUrl;
    
    // Replace server variables
    if (server.variables) {
      for (const [key, varDef] of Object.entries(server.variables)) {
        const value = config.server.variables[key] || (varDef as any).default || '';
        baseUrl = baseUrl.replace(`{${key}}`, value);
      }
    }
  }
  
  // Replace path parameters
  let path = op.path;
  for (const param of op.parameters) {
    if (param.in === 'path') {
      const schema = param.schema as Record<string, any> | undefined;
      const value = String(param.example || param.default || generateExampleValue(schema));
      path = path.replace(`{${param.name}}`, encodeURIComponent(value));
    }
  }
  
  return `${baseUrl}${path}`;
}

/**
 * Generate placeholder snippet
 */
function generatePlaceholderSnippet(op: OperationDescriptor, langConfig: { language: string; client: string | undefined }): string {
  const method = op.method;
  const path = op.path;
  
  switch (langConfig.language) {
    case 'shell':
    case 'curl':
      return `curl -X ${method} '${path}' \\
  -H 'Authorization: Bearer <TOKEN>' \\
  -H 'Content-Type: application/json'`;
      
    case 'node':
      if (langConfig.client === 'axios') {
        return `const axios = require('axios');

const response = await axios.${method.toLowerCase()}('${path}', {
  headers: {
    'Authorization': 'Bearer <TOKEN>',
    'Content-Type': 'application/json'
  }
});

console.log(response.data);`;
      }
      return `const response = await fetch('${path}', {
  method: '${method}',
  headers: {
    'Authorization': 'Bearer <TOKEN>',
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
console.log(data);`;
      
    case 'python':
      if (langConfig.client === 'requests') {
        return `import requests

response = requests.${method.toLowerCase()}(
    '${method}', '${path}',
    headers={'Authorization': 'Bearer <TOKEN>'}
)

print(response.json())`;
      }
      return `import urllib.request
import json

req = urllib.request.Request(
    '${method}', '${path}',
    headers={'Authorization': 'Bearer <TOKEN>'}
)

with urllib.request.urlopen(req) as response:
    print(json.loads(response.read()))`;
      
    default:
      return `// ${method} ${path}
// Authorization: Bearer <TOKEN>
`;
  }
}

/**
 * Generate output files
 */
async function generateOutputFiles(
  operationResults: OperationResult[],
  config: GenerationConfig
): Promise<void> {
  const snippetsDir = join(config.output, 'snippets');
  await ensureDirectory(snippetsDir);
  
  for (const opResult of operationResults) {
    const opDir = join(snippetsDir, opResult.operationId);
    await ensureDirectory(opDir);
    
    // Write index.json
    await writeFile(
      join(opDir, 'index.json'),
      JSON.stringify({
        operationId: opResult.operationId,
        method: opResult.method,
        path: opResult.path,
        snippets: opResult.snippets.filter(s => !s.error).map(s => ({
          language: s.language,
          client: s.client,
          highlightMode: s.highlightMode
        }))
      }, null, 2)
    );
    
    // Write individual snippet files
    for (const snippet of opResult.snippets) {
      if (snippet.error || !snippet.code) continue;
      
      const ext = getFileExtension(snippet.language, snippet.client);
      const filename = snippet.client 
        ? `${snippet.language}-${snippet.client}.${ext}`
        : `${snippet.language}.${ext}`;
      
      await writeFile(join(opDir, filename), snippet.code);
    }
  }
  
  console.log(`\nSnippet files written to: ${snippetsDir}`);
}

/**
 * Get file extension for language
 */
function getFileExtension(language: string, client?: string): string {
  const extensions: Record<string, string> = {
    shell: 'sh',
    curl: 'sh',
    node: 'js',
    javascript: 'js',
    python: 'py',
    python3: 'py',
    java: 'java',
    kotlin: 'kt',
    csharp: 'cs',
    go: 'go',
    ruby: 'rb',
    php: 'php',
    swift: 'swift',
    objc: 'm',
    objectivec: 'm',
    c: 'c',
    cpp: 'cpp',
    rust: 'rs'
  };
  
  return extensions[language] || extensions[client!] || 'txt';
}

/**
 * Ensure directory exists
 */
async function ensureDirectory(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    await mkdir(path, { recursive: true });
  }
}

/**
 * Chunk array for concurrency control
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate totals from operation results
 */
function calculateTotals(operationResults: OperationResult[]): GenerationTotals {
  return {
    operationsTotal: operationResults.length,
    operationsProcessed: operationResults.filter(o => o.snippets.length > 0).length,
    snippetsSuccess: operationResults.reduce((sum, o) => sum + o.successCount, 0),
    snippetsFailed: operationResults.reduce((sum, o) => sum + o.failureCount, 0),
    snippetsSkipped: operationResults.reduce((sum, o) => sum + o.skipCount, 0)
  };
}

/**
 * Create metadata
 */
function createMetadata(
  config: GenerationConfig,
  startTime: number,
  specInfo?: { title: string; version: string; openapi: string }
): ManifestMetadata {
  return {
    input: config.input,
    output: config.output,
    languages: config.languages.map(l => l.client ? `${l.language}:${l.client}` : l.language),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    specInfo
  };
}

/**
 * Create minimal manifest for dry run
 */
function createMinimalManifest(
  config: GenerationConfig,
  startTime: number,
  specInfo: { title: string; version: string; openapi: string } | undefined,
  operationCount: number
): GenerationManifest {
  return {
    metadata: createMetadata(config, startTime, specInfo),
    totals: {
      operationsTotal: operationCount,
      operationsProcessed: 0,
      snippetsSuccess: 0,
      snippetsFailed: 0,
      snippetsSkipped: 0
    },
    operations: [],
    unresolvedIssues: []
  };
}

// Export for programmatic use
export { GenerationConfig, GenerationManifest } from './types.js';
export { ErrorCode } from './types.js';
