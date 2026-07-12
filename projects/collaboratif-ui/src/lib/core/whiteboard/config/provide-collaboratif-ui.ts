import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from './tokens';

export interface CollaboratifUiConfig {
  apiUrl: string;
  /**
   * Optional accessor for the current bearer (opaque access) token, used to authenticate the
   * whiteboard real-time STOMP `CONNECT` frame. Return `null` when unauthenticated. When omitted,
   * real-time sync cannot authenticate and stays read-only (server rejects the CONNECT) — the
   * shell should bridge its own auth here, e.g. `bearerToken: () => inject(AuthService).accessToken()`.
   */
  bearerToken?: () => string | null;
}

/** Configures @pivot-platform/collaboratif-ui. Call this in the consuming app's providers array. */
export function provideCollaboratifUi(config: CollaboratifUiConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: COLLABORATIF_API_URL, useValue: config.apiUrl },
    ...(config.bearerToken
      ? [{ provide: COLLABORATIF_BEARER_TOKEN, useValue: config.bearerToken }]
      : []),
  ]);
}
