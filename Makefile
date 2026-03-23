SHELL := /bin/bash

INPUT ?= ./openapi.yaml
LANGUAGES ?= shell:curl,node:axios
CONCURRENCY ?= 8
EXTRA ?=
NPM_SCOPE ?= @ansrivas
NPM_REGISTRY ?= https://registry.npmjs.org/

.PHONY: help install build dev lint test clean generate pack whoami publish publish-public release-patch release-minor release-major

help:
	@echo "Common targets:"
	@echo "  make install            Install dependencies"
	@echo "  make build              Compile TypeScript"
	@echo "  make dev EXTRA='...'    Build + run CLI with extra args"
	@echo "  make lint               Run ESLint"
	@echo "  make test               Run tests"
	@echo "  make clean              Remove dist/"
	@echo "  make generate INPUT=./openapi.yaml LANGUAGES='shell:curl,node:axios' [CONCURRENCY=8] [EXTRA='...']"
	@echo "  make pack               Preview package contents (npm pack --dry-run)"
	@echo "  make whoami             Verify npm auth using NPM_TOKEN"
	@echo "  make publish-public     Build + publish scoped package as public (first publish safe)"
	@echo "  make publish            Build + publish (normal release)"
	@echo "  make release-patch      npm version patch + publish"
	@echo "  make release-minor      npm version minor + publish"
	@echo "  make release-major      npm version major + publish"
	@echo ""
	@echo "Required for auth targets: export NPM_TOKEN='npm_xxx'"

install:
	npm install

build:
	npm run build

dev:
	npm run dev -- $(EXTRA)

lint:
	npm run lint

test:
	npm test

clean:
	npm run clean

generate: build
	node dist/cli.js -i "$(INPUT)" -l "$(LANGUAGES)" --concurrency "$(CONCURRENCY)" $(EXTRA)

pack: build
	npm pack --dry-run

whoami:
	@bash -lc 'set -euo pipefail; \
	if [ -z "$$NPM_TOKEN" ]; then \
	  echo "NPM_TOKEN is required. Example: export NPM_TOKEN=\"npm_xxx\""; \
	  exit 1; \
	fi; \
	tmp="$$(mktemp)"; \
	trap "rm -f \"$$tmp\"" EXIT; \
	printf "//registry.npmjs.org/:_authToken=%s\\n$(NPM_SCOPE):registry=$(NPM_REGISTRY)\\n" "$$NPM_TOKEN" > "$$tmp"; \
	NPM_CONFIG_USERCONFIG="$$tmp" npm whoami'

publish-public: build pack
	@bash -lc 'set -euo pipefail; \
	if [ -z "$$NPM_TOKEN" ]; then \
	  echo "NPM_TOKEN is required. Example: export NPM_TOKEN=\"npm_xxx\""; \
	  exit 1; \
	fi; \
	tmp="$$(mktemp)"; \
	trap "rm -f \"$$tmp\"" EXIT; \
	printf "//registry.npmjs.org/:_authToken=%s\\n$(NPM_SCOPE):registry=$(NPM_REGISTRY)\\n" "$$NPM_TOKEN" > "$$tmp"; \
	NPM_CONFIG_USERCONFIG="$$tmp" npm publish --access public'

publish: build pack
	@bash -lc 'set -euo pipefail; \
	if [ -z "$$NPM_TOKEN" ]; then \
	  echo "NPM_TOKEN is required. Example: export NPM_TOKEN=\"npm_xxx\""; \
	  exit 1; \
	fi; \
	tmp="$$(mktemp)"; \
	trap "rm -f \"$$tmp\"" EXIT; \
	printf "//registry.npmjs.org/:_authToken=%s\\n$(NPM_SCOPE):registry=$(NPM_REGISTRY)\\n" "$$NPM_TOKEN" > "$$tmp"; \
	NPM_CONFIG_USERCONFIG="$$tmp" npm publish'

release-patch:
	npm version patch
	$(MAKE) publish

release-minor:
	npm version minor
	$(MAKE) publish

release-major:
	npm version major
	$(MAKE) publish
