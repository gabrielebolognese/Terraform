# Project context

Blank TypeScript scaffold. Node >= 20, ESM, strict tsconfig, vitest for tests.

## Conventions

- ESM only. Relative imports must end in `.js` (e.g. `import { x } from "./thing.js"`).
- Source lives in `src/`, build output in `dist/` (gitignored).
- Tests are colocated as `*.test.ts` next to the code they cover.
- Run `npm run typecheck` before considering a change done.

## Commands

- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm test`
