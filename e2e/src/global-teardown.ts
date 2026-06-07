import { bringStackDown } from './stack';

/** Playwright global teardown — drops the whole stack + Postgres volume. */
export default function globalTeardown(): void {
  bringStackDown();
}
