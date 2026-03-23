#!/usr/bin/env node

/**
 * CLI entry point for openapi-snippets
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { generate } from './index.js';
import {
  GenerationConfig,
  LanguageConfig,
  OperationFilters,
  AuthConfig,
  ServerConfig,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.replace('/cli.js', '');

const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

class CLIError extends Error {
  constructor(
    message: string,
    public remediation?: string
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

interface CLIOptions {
  input: string;
  languages: string;
  operationIds?: string;
  includeTags?: string;
  excludeTags?: string;
  pathRegex?: string;
  methods?: string;
  authFile?: string;
  serverIndex?: number;
  serverVars?: string;
  includeOptional?: boolean;
  concurrency?: number;
}

function parseLanguageString(langStr: string): LanguageConfig[] {
  return langStr.split(',').map((l) => {
    const parts = l.trim().split(':');
    return {
      language: parts[0].toLowerCase(),
      client: parts[1]?.toLowerCase(),
    };
  });
}

function parseFilters(options: CLIOptions): OperationFilters {
  const filters: OperationFilters = {};

  if (options.operationIds) {
    filters.operationIds = options.operationIds.split(',').map((s) => s.trim());
  }

  if (options.includeTags) {
    filters.includeTags = options.includeTags.split(',').map((s) => s.trim());
  }

  if (options.excludeTags) {
    filters.excludeTags = options.excludeTags.split(',').map((s) => s.trim());
  }

  if (options.pathRegex) {
    try {
      new RegExp(options.pathRegex);
      filters.pathRegex = options.pathRegex;
    } catch {
      console.error(`Invalid regex: ${options.pathRegex}`);
      process.exit(1);
    }
  }

  if (options.methods) {
    filters.methods = options.methods.split(',').map((s) => s.trim().toUpperCase());
  }

  return filters;
}

function parseAuth(options: CLIOptions): AuthConfig {
  const auth: AuthConfig = {};

  if (options.authFile) {
    try {
      const authData = JSON.parse(readFileSync(options.authFile, 'utf-8'));
      if (authData.apiKey) auth.apiKey = authData.apiKey;
      if (authData.bearerToken) auth.bearerToken = authData.bearerToken;
      if (authData.username && authData.password) {
        auth.basicAuth = { username: authData.username, password: authData.password };
      }
    } catch {
      console.error(`Failed to read auth file: ${options.authFile}`);
      process.exit(1);
    }
  }

  return auth;
}

function parseServerConfig(options: CLIOptions): ServerConfig {
  const config: ServerConfig = {
    index: options.serverIndex ?? 0,
    variables: {},
  };

  if (options.serverVars) {
    const pairs = options.serverVars.split(',');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        config.variables[key.trim()] = value.trim();
      }
    }
  }

  return config;
}

function parseConcurrency(options: CLIOptions): number {
  const defaultConcurrency = 8;
  const value = options.concurrency ?? defaultConcurrency;

  if (!Number.isInteger(value) || value < 1) {
    console.error('--concurrency must be a positive integer');
    process.exit(1);
  }

  return value;
}

async function main() {
  const [major] = process.version.slice(1).split('.').map(Number);
  if (major < 18) {
    console.error(`Node.js 18+ required, but found ${process.version}`);
    process.exit(1);
  }

  const program = new Command();

  program
    .name('openapi-snippets')
    .description('Inject x-codeSamples into an OpenAPI spec from generated snippets')
    .version(packageJson.version)
    .requiredOption('-i, --input <path>', 'OpenAPI file path or URL')
    .requiredOption(
      '-l, --languages <list>',
      'Comma-separated list of languages (e.g., shell,node:axios,python:requests)'
    )
    .option('--operation-ids <ids>', 'Comma-separated operation IDs to include')
    .option('--include-tags <tags>', 'Comma-separated tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated tags to exclude')
    .option('--path-regex <regex>', 'Regex to filter paths')
    .option('--methods <methods>', 'Comma-separated HTTP methods to include (GET,POST,PUT,DELETE)')
    .option('--auth-file <path>', 'JSON file with authentication config')
    .option('--server-index <index>', 'Server index to use')
    .option('--server-vars <vars>', 'Server variable overrides (key=value,key2=value2)')
    .option('--include-optional', 'Include optional parameters in generated snippets')
    .option(
      '--concurrency <number>',
      'Maximum number of operations to process concurrently (default: 8)',
      (value) => Number.parseInt(value, 10)
    )
    .addHelpText(
      'after',
      `
Examples:
  $ openapi-snippets -i petstore.yaml -l shell,node:axios
  $ openapi-snippets -i spec.yaml -l go,java:okhttp --auth-file ./auth.json
  $ openapi-snippets -i spec.yaml -l node --include-tags users --exclude-tags internal
  $ openapi-snippets -i spec.yaml -l shell:curl,node:axios --concurrency 6
`
    );

  program.parse();

  const opts = program.opts<CLIOptions>();

  if (!opts.input) {
    console.error('--input/-i is required');
    process.exit(1);
  }

  if (!opts.languages) {
    console.error('--languages/-l is required');
    process.exit(1);
  }

  // Check input file exists (if not a URL)
  if (!opts.input.startsWith('http')) {
    if (!existsSync(opts.input)) {
      console.error(`Input file not found: ${opts.input}`);
      process.exit(1);
    }
  }

  const config: GenerationConfig = {
    input: opts.input,
    languages: parseLanguageString(opts.languages),
    filters: parseFilters(opts),
    auth: parseAuth(opts),
    server: parseServerConfig(opts),
    includeOptional: opts.includeOptional ?? false,
    concurrency: parseConcurrency(opts),
  };

  // Validate languages
  const validLanguages = [
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
  const validClients: Record<string, string[]> = {
    node: ['axios', 'native', 'unirest', 'request'],
    python: ['requests', 'python3', 'fetch'],
    java: ['okhttp', 'unirest', 'httpcomponents'],
    csharp: ['httpclient', 'restsharp', 'resttemplate'],
    go: ['native', 'nativehttp'],
    ruby: ['native', 'net-http'],
    php: ['curl', 'guzzle', 'pecl-http'],
    swift: ['nsurlsession', 'urlsession'],
    kotlin: ['okhttp', 'fuel'],
    shell: ['curl', 'wget'],
  };

  for (const lang of config.languages) {
    if (!validLanguages.includes(lang.language)) {
      console.error(`Unsupported language: ${lang.language}`);
      console.error(`Valid languages: ${validLanguages.join(', ')}`);
      process.exit(1);
    }

    if (
      lang.client &&
      validClients[lang.language] &&
      !validClients[lang.language].includes(lang.client)
    ) {
      console.warn(
        `Warning: Client '${lang.client}' for language '${lang.language}' may not be supported`
      );
    }
  }

  try {
    await generate(config);
  } catch (error) {
    if (error instanceof CLIError) {
      console.error(`\n${error.message}`);
      if (error.remediation) {
        console.error(error.remediation);
      }
      process.exit(1);
    }
    console.error('\nFatal error:', error);
    process.exit(1);
  }
}

main();
