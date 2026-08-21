export interface GoogleOAuthRefreshConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  timeoutMs: number;
}

type FetchImplementation = typeof fetch;

interface CachedToken {
  value: string;
  refreshAfterMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class GoogleOAuthAccessTokenProvider {
  private readonly config: GoogleOAuthRefreshConfig;
  private readonly fetchImpl: FetchImplementation;
  private readonly now: () => number;
  private cached?: CachedToken;

  constructor(
    config: GoogleOAuthRefreshConfig,
    fetchImpl: FetchImplementation = fetch,
    now: () => number = () => Date.now(),
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && this.cached.refreshAfterMs > this.now()) {
      return this.cached.value;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    timeout.unref();

    try {
      const body = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      });
      const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Google OAuth refresh failed with HTTP ${response.status}`);

      const payload: unknown = await response.json();
      const accessToken = isRecord(payload) && typeof payload.access_token === 'string'
        ? payload.access_token.trim()
        : '';
      const expiresIn = isRecord(payload) && typeof payload.expires_in === 'number'
        ? payload.expires_in
        : 0;
      if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('Google OAuth refresh returned an invalid token response');
      }

      const safetyWindowMs = Math.min(60_000, Math.floor(expiresIn * 1_000 / 2));
      this.cached = {
        value: accessToken,
        refreshAfterMs: this.now() + expiresIn * 1_000 - safetyWindowMs,
      };
      return accessToken;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Google OAuth refresh timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
