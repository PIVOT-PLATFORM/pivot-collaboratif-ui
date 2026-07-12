import { InjectionToken } from '@angular/core';

/**
 * Base URL of the collaboratif backend API. Provided by the consuming app —
 * `provideCollaboratifUi()` when this module is lazy-loaded from the `pivot-ui` shell,
 * or `app.config.ts` (from `environment.apiUrl`) when this repo runs standalone.
 */
export const COLLABORATIF_API_URL = new InjectionToken<string>('COLLABORATIF_API_URL');

/**
 * Accessor returning the current bearer (opaque access) token for the whiteboard real-time
 * STOMP `CONNECT` frame, or `null` when unauthenticated. Supplied by the consuming app via
 * `provideCollaboratifUi({ bearerToken })` so this library bridges the host's auth without
 * depending on a concrete `AuthService`. Defaults to a no-op returning `null` (real-time sync
 * then stays read-only, falling back to the E2E test hook if present) — see
 * {@link WhiteboardSyncService} `buildConnectHeaders`.
 */
export const COLLABORATIF_BEARER_TOKEN = new InjectionToken<() => string | null>(
  'COLLABORATIF_BEARER_TOKEN',
  { providedIn: 'root', factory: () => (): string | null => null },
);
