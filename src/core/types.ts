export interface GlobalOptions {
  url?: string;
  token?: string;
  json?: boolean;
  timeout?: string;
}

export interface RuntimeContext {
  baseUrl: string;
  token?: string;
  refreshToken?: string;
  authApiUrl?: string;
  authBrowserUrl?: string;
  json: boolean;
  timeoutMs: number;
}

export interface PersistedConfig {
  baseUrl?: string;
  token?: string;
  refreshToken?: string;
  authApiUrl?: string;
  authBrowserUrl?: string;
  timeoutMs?: number;
}
