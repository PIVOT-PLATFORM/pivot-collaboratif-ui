import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Composant racine du harnais de développement (dev harness) du module Collaboratif.
 *
 * Ce shell ne sert qu'au développement local et à l'exécution des E2E (voir `app.routes.ts`) —
 * il n'est **jamais** servi en production : le shell réel `pivot-ui` consomme le package publié
 * `@pivot-platform/collaboratif-ui` en lazy-loading. Le `<router-outlet>` ci-dessous sert les
 * routes des features réellement implémentées dans ce repo (whiteboard — voir
 * `projects/collaboratif-ui/src/lib/whiteboard/`), au fil de leur ajout.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, TranslocoPipe],
  template: `
    <main>
      <h1>{{ 'app.title' | transloco }}</h1>
      <p>{{ 'app.devHarnessNotice' | transloco }}</p>
      <router-outlet />
    </main>
  `,
})
export class App {}
