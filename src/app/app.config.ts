import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { routes } from './app.routes';
import { TranslocoHttpLoader } from './core/i18n/transloco.loader';
import { provideCollaboratifUi } from '../../projects/collaboratif-ui/src/lib/core/whiteboard/config/provide-collaboratif-ui';
import { environment } from '../environments/environment';

/**
 * Configuration racine — bootstrap du déploiement standalone (nginx, port 8090 en local).
 * Seul endroit du repo qui importe encore `environment.ts` directement (bénéficie du
 * `fileReplacements` Angular CLI de ce projet d'app) — le reste du code whiteboard reçoit son
 * apiUrl via `provideCollaboratifUi`/`COLLABORATIF_API_URL` (voir EN17.9), pour rester
 * consommable tel quel une fois publié en librairie et lazy-loadé dans le shell pivot-ui.
 *
 * Pas d'auth, pas d'intercepteur HTTP tant que `fr.pivot:pivot-core-starter` (équivalent
 * Angular `@pivot/ui-core`) n'est pas consommable (voir CLAUDE.md).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    provideCollaboratifUi({ apiUrl: environment.apiUrl }),
    provideTransloco({
      config: {
        availableLangs: ['fr', 'en'],
        defaultLang: 'fr',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: TranslocoHttpLoader,
    }),
  ],
};
