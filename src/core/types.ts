export interface GlobalOptions {
  url?: string;
  moderationUrl?: string;
  token?: string;
  json?: boolean;
  timeout?: string;
}

export interface RuntimeContext {
  baseUrl: string;
  moderationBaseUrl: string;
  token?: string;
  refreshToken?: string;
  authApiUrl?: string;
  authBrowserUrl?: string;
  json: boolean;
  timeoutMs: number;
}

export interface PersistedConfig {
  baseUrl?: string;
  moderationBaseUrl?: string;
  token?: string;
  refreshToken?: string;
  authApiUrl?: string;
  authBrowserUrl?: string;
  timeoutMs?: number;
}
