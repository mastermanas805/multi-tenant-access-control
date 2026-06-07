import { bringStackUp } from './stack';

/**
 * Playwright global setup. Brings the WHOLE enforcement stack up (docker compose
 * up -d --build + scripts/bootstrap.sh), then waits for every service health
 * endpoint AND the runtime-published Cerbos policy to be effective before any
 * test runs. This is the single source of stack lifecycle for the suite.
 */
export default async function globalSetup(): Promise<void> {
  await bringStackUp();
}
