.PHONY: setup dev test lint format check health ci clean backend extension rebuild

setup:
	pnpm install
	git config core.hooksPath scripts/git-hooks

dev:
	pnpm --filter publisher-backend dev & pnpm --filter publisher-fill-assistant dev

test:
	pnpm -r test

lint:
	pnpm lint

format:
	pnpm format

check: test lint
	pnpm compile

health: check
	bash scripts/check-all.sh

ci:
	pnpm lint:ci
	pnpm compile
	pnpm -r test

backend:
	bash scripts/start-backend.sh

extension:
	pnpm build:extension

rebuild:
	bash scripts/rebuild.sh

clean:
	rm -rf node_modules packages/extension/.wxt packages/extension/.output packages/extension/node_modules packages/backend/dist packages/backend/node_modules
