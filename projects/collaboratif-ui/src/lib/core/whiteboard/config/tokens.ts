import { InjectionToken } from '@angular/core';

/**
 * Base URL of the collaboratif backend API. Provided by the consuming app —
 * `provideCollaboratifUi()` when this module is lazy-loaded from the `pivot-ui` shell,
 * or `app.config.ts` (from `environment.apiUrl`) when this repo runs standalone.
 */
export const COLLABORATIF_API_URL = new InjectionToken<string>('COLLABORATIF_API_URL');

/**
 * Accessor returning the current bearer (opaque access) token for the whiteboard real-time
 * STOMP `CONNECT` frame, or `null` when unauthenticated. Bridges the host app's auth without this
 * library depending on a concrete `AuthService`. Invoked lazily at every (re)connect.
 *
 * Provide it with a factory that captures the auth service in an injection context — do NOT
 * `inject()` inside the returned accessor, which runs outside any injection context (NG0203):
 *
 * ```ts
 * { provide: COLLABORATIF_BEARER_TOKEN,
 *   useFactory: (auth: AuthService) => (): string | null => auth.accessToken(),
 *   deps: [AuthService] }
 * ```
 *
 * (or the convenience `provideCollaboratifUi({ bearerToken })` for a self-contained accessor.)
 * Defaults to a no-op returning `null` (real-time sync then stays read-only, falling back to the
 * E2E test hook if present) — see {@link WhiteboardSyncService} `buildConnectHeaders`.
 */
export const COLLABORATIF_BEARER_TOKEN = new InjectionToken<() => string | null>(
  'COLLABORATIF_BEARER_TOKEN',
  { providedIn: 'root', factory: () => (): string | null => null },
);

/**
 * The current user's presence identity, as displayed to other participants on a board
 * (avatar + name in the presence bar, cursor labels). Bridges the host app's auth/profile
 * without this library depending on a concrete `AuthService` — the same seam pattern as
 * {@link COLLABORATIF_BEARER_TOKEN}.
 *
 * Returned by an accessor invoked lazily at each `board:join` (initial join and every
 * reconnect), so it always reflects the freshest known profile. A `null` `displayName` means
 * "unknown" — the store then omits it from the JOIN payload so the backend applies its own
 * fallback (`"Anonymous"`) rather than persisting a null name.
 *
 * Defaults to a no-op returning `{ displayName: null, avatarUrl: null }`. Provide it with a
 * factory that captures the profile source in an injection context (do NOT `inject()` inside
 * the returned accessor — it runs outside any injection context, NG0203):
 *
 * ```ts
 * { provide: COLLABORATIF_CURRENT_USER,
 *   useFactory: (profile: ProfileService) =>
 *     (): CollaboratifCurrentUser => ({ displayName: profile.name(), avatarUrl: profile.avatar() }),
 *   deps: [ProfileService] }
 * ```
 *
 * (or the convenience `provideCollaboratifUi({ currentUser })`.)
 */
export interface CollaboratifCurrentUser {
  displayName: string | null;
  avatarUrl: string | null;
}

export const COLLABORATIF_CURRENT_USER = new InjectionToken<() => CollaboratifCurrentUser>(
  'COLLABORATIF_CURRENT_USER',
  {
    providedIn: 'root',
    factory: () => (): CollaboratifCurrentUser => ({ displayName: null, avatarUrl: null }),
  },
);
