#!/usr/bin/env node

/**
 * CLI entry point for openapi-snippets
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { generate } from './index.js';
import {
  GenerationConfig,
  LanguageConfig,
  OperationFilters,
  AuthConfig,
  ServerConfig,
  GenerationOptions,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.replace('/cli.js', '');

const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));

// Exit codes and error handling
enum ExitCode {
  SUCCESS = 0,
  FATAL_ERROR = 1,
  STRICT_MODE_FAILURE = 2,
  PARTIAL_FAILURE = 3,
  VALIDATION_ERROR = 4,
}

class CLIError extends Error {
  constructor(
    message: string,
    public exitCode: ExitCode = ExitCode.FATAL_ERROR,
    public remediation?: string
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

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
      // Validate regex by compiling it, then store as string for serialization
      new RegExp(options.pathRegex);
      filters.pathRegex = options.pathRegex;
    } catch (e) {
      console.error(`Invalid regex: ${options.pathRegex}`);
      process.exit(ExitCode.VALIDATION_ERROR);
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
      if (authData.selectedScheme) auth.selectedScheme = authData.selectedScheme;
    } catch (e) {
      console.error(`Failed to read auth file: ${options.authFile}`);
      process.exit(ExitCode.VALIDATION_ERROR);
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

/**
 * Create a progress callback for verbose output
 */
function createProgressCallback() {
  let lastProgress = 0;
  return (current: number, total: number, message: string) => {
    const percent = Math.round((current / total) * 100);
    if (percent !== lastProgress) {
      process.stdout.write(`\r[${percent}%] ${current}/${total} - ${message}`);
      lastProgress = percent;
    }
  };
}

async function main() {
  // Check Node.js version compatibility
  const [major] = process.version.slice(1).split('.').map(Number);
  if (major < 18) {
    console.error(`⚠️  Node.js 18+ required, but found ${process.version}`);
    console.error('Consider using nvm: nvm use 18');
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const program = new Command();

  program
    .name('openapi-snippets')
    .description('Generate code snippets from OpenAPI specifications')
    .version(packageJson.version)
    .requiredOption('-i, --input <path>', 'OpenAPI file path or URL')
    .requiredOption(
      '-l, --languages <list>',
      'Comma-separated list of languages (e.g., shell,node:axios,python:requests)'
    )
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
    .option('-v, --verbose', 'Verbose output')
    .addHelpText('after', `
Examples:
  $ openapi-snippets -i petstore.yaml -l shell,node:axios
  $ openapi-snippets -i openapi.json -l python:requests -o ./snippets
  $ openapi-snippets -i api.yaml -l curl -c 20 --verbose
  $ openapi-snippets -i spec.yaml -l go,java:okhttp --auth-file ./auth.json
  $ openapi-snippets -i spec.yaml -l node --include-tags users --exclude-tags internal

For more help, see: https://github.com/example/openapi-snippets
`);

  program.parse();

  const opts = program.opts<CLIOptions>();

  // Validate required options early
  if (!opts.input) {
    console.error('❌ --input/-i is required');
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  if (!opts.languages) {
    console.error('❌ --languages/-l is required');
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  // Check input file exists (if not a URL)
  if (!opts.input.startsWith('http')) {
    const { existsSync } = await import('fs');
    if (!existsSync(opts.input)) {
      console.error(`❌ Input file not found: ${opts.input}`);
      console.error('If specifying a URL, ensure it starts with http:// or https://');
      process.exit(ExitCode.VALIDATION_ERROR);
    }
  }

  // Build config
  const config: GenerationConfig = {
    input: opts.input,
    output: opts.output ?? './generated-snippets',
    languages: parseLanguageString(opts.languages),
    filters: parseFilters(opts),
    auth: parseAuth(opts),
    server: parseServerConfig(opts),
    options: {
      ...parseGenerationOptions(opts),
      onProgress: opts.verbose ? createProgressCallback() : undefined,
    },
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
      process.exit(ExitCode.VALIDATION_ERROR);
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

  // Run generation
  try {
    if (opts.verbose) {
      console.log('Configuration:', JSON.stringify(config, null, 2));
    }

    const manifest = await generate(config);

    // Print summary
    console.log('\n=== Generation Summary ===');
    console.log(
      `Operations processed: ${manifest.totals.operationsProcessed}/${manifest.totals.operationsTotal}`
    );
    console.log(`Snippets generated: ${manifest.totals.snippetsSuccess}`);
    console.log(`Snippets failed: ${manifest.totals.snippetsFailed}`);
    console.log(`Snippets skipped: ${manifest.totals.snippetsSkipped}`);
    console.log(`Duration: ${manifest.metadata.durationMs}ms`);

    if (manifest.metadata.specInfo) {
      console.log(
        `\nSpec: ${manifest.metadata.specInfo.title} v${manifest.metadata.specInfo.version}`
      );
    }

    // Exit code
    const hasFailures = manifest.totals.snippetsFailed > 0;
    const hasSkipped = manifest.totals.snippetsSkipped > 0;

    if (config.options.strict && hasFailures) {
      console.error('\nStrict mode: Exiting with error due to failures');
      process.exit(ExitCode.STRICT_MODE_FAILURE);
    }

    if (config.options.failOnPartial && hasFailures) {
      console.error('\nPartial failure detected: Exiting with error');
      process.exit(ExitCode.PARTIAL_FAILURE);
    }

    if (config.options.failOnPartial && hasSkipped) {
      console.error('\nSkipped operations detected: Exiting with error');
      process.exit(ExitCode.PARTIAL_FAILURE);
    }

    process.exit(ExitCode.SUCCESS);
  } catch (error) {
    if (error instanceof CLIError) {
      console.error(`\n❌ ${error.message}`);
      if (error.remediation) {
        console.error(`\n💡 ${error.remediation}`);
      }
      process.exit(error.exitCode);
    }
    console.error('\n❌ Fatal error:', error);
    process.exit(ExitCode.FATAL_ERROR);
  }
}

main();
