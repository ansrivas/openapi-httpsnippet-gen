/**
 * Core types and interfaces for OpenAPI snippet generation
 */

// ============================================================================
// OpenAPI 3.x Specification Types
// ============================================================================

export interface OpenAPISpec {
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  openapi?: string;
  paths?: Record<string, PathItem>;
  servers?: Server[];
  security?: SecurityRequirement[];
}

export interface PathItem {
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  patch?: Operation;
  trace?: Operation;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: SecurityRequirement[];
  requestBody?: RequestBody;
  parameters?: Parameter[];
  deprecated?: boolean;
  responses?: Record<string, Response>;
  // Allow extension properties (e.g., x-codeSamples)
  [key: string]: unknown;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: unknown;
  description?: string;
  example?: unknown;
}

export interface Server {
  url: string;
  description?: string;
  variables?: Record<string, ServerVariable>;
}

export interface ServerVariable {
  default?: string;
  enum?: string[];
  description?: string;
}

export interface SecurityRequirement {
  [scheme: string]: string[];
}

export interface RequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, MediaType>;
}

export interface MediaType {
  schema?: unknown;
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
}

export interface Response {
  description?: string;
  content?: Record<string, MediaType>;
}

// ============================================================================
// Error codes for classification
// ============================================================================
export enum ErrorCode {
  E_PARSE_INVALID_SPEC = 'E_PARSE_INVALID_SPEC',
  E_UNSUPPORTED_LANGUAGE = 'E_UNSUPPORTED_LANGUAGE',
  E_UNSUPPORTED_CLIENT = 'E_UNSUPPORTED_CLIENT',
  E_OPERATION_BUILD_FAILED = 'E_OPERATION_BUILD_FAILED',
  E_SNIPPET_GENERATION_FAILED = 'E_SNIPPET_GENERATION_FAILED',
}

// Descriptor for an operation extracted from OpenAPI spec
export interface OperationDescriptor {
  operationId: string;
  method: string;
  path: string;
  summary: string | undefined;
  description: string | undefined;
  tags: string[];
  security: Record<string, string[]>[];
  requestBodyInfo: RequestBodyInfo | undefined;
  parameters: ParameterInfo[];
  deprecated: boolean;
}

// Request body information
export interface RequestBodyInfo {
  required: boolean;
  contentType: string;
  schema: unknown;
  example?: unknown;
  examples?: Record<string, unknown>;
}

// Parameter information
export interface ParameterInfo {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: unknown;
  example?: unknown;
  default?: unknown;
  description?: string;
}

// Generation configuration from CLI
export interface GenerationConfig {
  input: string;
  languages: LanguageConfig[];
  filters: OperationFilters;
  auth: AuthConfig;
  server: ServerConfig;
  includeOptional: boolean;
}

// Parsed language with optional client
export interface LanguageConfig {
  language: string;
  client: string | undefined;
}

// Operation filtering options
export interface OperationFilters {
  operationIds?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  pathRegex?: string;
  methods?: string[];
}

// Authentication configuration
export interface AuthConfig {
  apiKey?: string;
  bearerToken?: string;
  basicAuth?: { username: string; password: string };
}

// Server configuration
export interface ServerConfig {
  index: number;
  variables: Record<string, string>;
}

// Result of snippet generation for one operation+language
export interface SnippetResult {
  operationKey: string;
  language: string;
  client: string | undefined;
  code: string;
  highlightMode: string | undefined;
  warnings: string[];
  error: SnippetError | undefined;
}

// Error details for a snippet
export interface SnippetError {
  code: ErrorCode;
  message: string;
  remediation: string;
}

// Per-operation results in manifest
export interface OperationResult {
  operationId: string;
  method: string;
  path: string;
  snippets: SnippetResult[];
  successCount: number;
  failureCount: number;
  skipCount: number;
}
