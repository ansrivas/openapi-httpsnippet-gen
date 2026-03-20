#!/usr/bin/env node

/**
 * CLI entry point for openapi-snippets
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { generate } from './index.js';
import { GenerationConfig, LanguageConfig, OperationFilters, AuthConfig, ServerConfig, GenerationOptions } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.replace('/cli.js', '');

const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

interface CLIOptions {
  input: string;
  languages: string;
  output?: string;
  format?: string;
  operationIds?: string;
  includeTags?: string;
  excludeTags?: string;
  pathRegex?: string;
  methods?: string;
  authFile?: string;
  serverIndex?: number;
  serverVars?: string;
  concurrency?: number;
  strict?: boolean;
  failOnPartial?: boolean;
  includeOptional?: boolean;
  dryRun?: boolean;
  updateSpec?: boolean;
  generateSnippets?: boolean;
  verbose?: boolean;
}

function parseLanguageString(langStr: string): LanguageConfig[] {
  return langStr.split(',').map(l => {
    const parts = l.trim().split(':');
    return {
      language: parts[0].toLowerCase(),
      client: parts[1]?.toLowerCase()
    };
  });
}

function parseFilters(options: CLIOptions): OperationFilters {
  const filters: OperationFilters = {};
  
  if (options.operationIds) {
    filters.operationIds = options.operationIds.split(',').map(s => s.trim());
  }
  
  if (options.includeTags) {
    filters.includeTags = options.includeTags.split(',').map(s => s.trim());
  }
  
  if (options.excludeTags) {
    filters.excludeTags = options.excludeTags.split(',').map(s => s.trim());
  }
  
  if (options.pathRegex) {
    try {
      filters.pathRegex = new RegExp(options.pathRegex);
    } catch (e) {
      console.error(`Invalid regex: ${options.pathRegex}`);
      process.exit(1);
    }
  }
  
  if (options.methods) {
    filters.methods = options.methods.split(',').map(s => s.trim().toUpperCase());
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
      if (authData.selectedScheme) auth.selectedScheme = authData.selectedScheme;
    } catch (e) {
      console.error(`Failed to read auth file: ${options.authFile}`);
      process.exit(1);
    }
  }
  
  return auth;
}

function parseServerConfig(options: CLIOptions): ServerConfig {
  const config: ServerConfig = {
    index: options.serverIndex ?? 0,
    variables: {}
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

function parseGenerationOptions(options: CLIOptions): GenerationOptions {
  return {
    concurrency: options.concurrency ?? 10,
    strict: options.strict ?? false,
    failOnPartial: options.failOnPartial ?? true,
    includeOptional: options.includeOptional ?? false,
    dryRun: options.dryRun ?? false,
    outputFormat: (options.format as 'json' | 'markdown') ?? 'json',
    generateFiles: options.generateSnippets ?? false,
    updateSpec: options.updateSpec ?? false,
  };
}

async function main() {
  const program = new Command();
  
  program
    .name('openapi-snippets')
    .description('Generate code snippets from OpenAPI specifications')
    .version(packageJson.version)
    .requiredOption('-i, --input <path>', 'OpenAPI file path or URL')
    .requiredOption('-l, --languages <list>', 'Comma-separated list of languages (e.g., shell,node:axios,python:requests)')
    .option('-o, --output <path>', 'Output directory', './generated-snippets')
    .option('-f, --format <format>', 'Output format: json or markdown', 'json')
    .option('--operation-ids <ids>', 'Comma-separated operation IDs to include')
    .option('--include-tags <tags>', 'Comma-separated tags to include')
    .option('--exclude-tags <tags>', 'Comma-separated tags to exclude')
    .option('--path-regex <regex>', 'Regex to filter paths')
    .option('--methods <methods>', 'Comma-separated HTTP methods to include (GET,POST,PUT,DELETE)')
    .option('--auth-file <path>', 'JSON file with authentication config')
    .option('--server-index <index>', 'Server index to use')
    .option('--server-vars <vars>', 'Server variable overrides (key=value,key2=value2)')
    .option('-c, --concurrency <n>', 'Max concurrent operations')
    .option('--strict', 'Fail on any per-operation/language failure')
    .option('--fail-on-partial', 'Fail on partial success (some operations failed)')
    .option('--include-optional', 'Include optional parameters')
    .option('--dry-run', 'Parse and list operations without generating snippets')
    .option('--update-spec', 'Update the input OpenAPI spec file with x-codeSamples')
    .option('--generate-snippets', 'Write individual snippet files to the output directory')
    .option('-v, --verbose', 'Verbose output');
  
  program.parse();
  
  const opts = program.opts<CLIOptions>();
  
  // Build config
  const config: GenerationConfig = {
    input: opts.input,
    output: opts.output ?? './generated-snippets',
    languages: parseLanguageString(opts.languages),
    filters: parseFilters(opts),
    auth: parseAuth(opts),
    server: parseServerConfig(opts),
    options: parseGenerationOptions(opts)
  };
  
  // Validate languages
  const validLanguages = ['shell', 'node', 'python', 'java', 'csharp', 'go', 'ruby', 'php', 'swift', 'kotlin', 'c', 'curl'];
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
    shell: ['curl', 'wget']
  };
  
  for (const lang of config.languages) {
    if (!validLanguages.includes(lang.language)) {
      console.error(`Unsupported language: ${lang.language}`);
      console.error(`Valid languages: ${validLanguages.join(', ')}`);
      process.exit(1);
    }
    
    if (lang.client && validClients[lang.language] && !validClients[lang.language].includes(lang.client)) {
      console.warn(`Warning: Client '${lang.client}' for language '${lang.language}' may not be supported`);
    }
  }
  
  // Run generation
  try {
    if (opts.verbose) {
      console.log('Configuration:', JSON.stringify(config, null, 2));
    }
    
    const manifest = await generate(config);
    
    // Print summary
    console.log('\n=== Generation Summary ===');
    console.log(`Operations processed: ${manifest.totals.operationsProcessed}/${manifest.totals.operationsTotal}`);
    console.log(`Snippets generated: ${manifest.totals.snippetsSuccess}`);
    console.log(`Snippets failed: ${manifest.totals.snippetsFailed}`);
    console.log(`Snippets skipped: ${manifest.totals.snippetsSkipped}`);
    console.log(`Duration: ${manifest.metadata.durationMs}ms`);
    
    if (manifest.metadata.specInfo) {
      console.log(`\nSpec: ${manifest.metadata.specInfo.title} v${manifest.metadata.specInfo.version}`);
    }
    
    // Exit code
    const hasFailures = manifest.totals.snippetsFailed > 0;
    const hasSkipped = manifest.totals.snippetsSkipped > 0;
    
    if (config.options.strict && hasFailures) {
      console.error('\nStrict mode: Exiting with error due to failures');
      process.exit(1);
    }
    
    if (config.options.failOnPartial && hasFailures) {
      console.error('\nPartial failure detected: Exiting with error');
      process.exit(2);
    }
    
    if (config.options.failOnPartial && hasSkipped) {
      console.error('\nSkipped operations detected: Exiting with error');
      process.exit(2);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  }
}

main();
