import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { provideTranslocoScope } from '@jsverse/transloco';
import { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN } from './tokens';

export interface CollaboratifUiConfig {
  apiUrl: string;
  /**
   * Optional accessor for the current bearer (opaque access) token, used to authenticate the
   * whiteboard real-time STOMP `CONNECT` frame. Return `null` when unauthenticated. When omitted,
   * real-time sync cannot authenticate and stays read-only (server rejects the CONNECT).
   *
   * The accessor is stored as a value and invoked lazily at connect time — i.e. **outside** an
   * Angular injection context — so it must NOT call `inject()` itself (that throws NG0203).
   * Capture the dependency up front instead. When the token comes from a service, prefer providing
   * {@link COLLABORATIF_BEARER_TOKEN} with a factory rather than this field:
   *
   * ```ts
   * { provide: COLLABORATIF_BEARER_TOKEN,
   *   useFactory: (auth: AuthService) => (): string | null => auth.accessToken(),
   *   deps: [AuthService] }
   * ```
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
    provideTranslocoScope({
      scope: 'whiteboard',
      loader: {
        // provide-collaboratif-ui.ts est sous src/lib/core/whiteboard/config/ → 3 niveaux jusqu'à src/lib/
        en: () => import('../../../i18n/en.json'),
        fr: () => import('../../../i18n/fr.json'),
      },
    }),
  ]);
}
