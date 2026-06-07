/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API Gateway — the ONLY backend this SPA talks to (DESIGN §13). */
  readonly VITE_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
