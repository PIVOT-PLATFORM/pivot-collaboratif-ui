import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Composant racine du shell du module Collaboratif.
 *
 * Bootstrap uniquement : aucune feature (whiteboard, quiz, session live, formulaire) n'est
 * encore implémentée. Ce composant sera lazy-loadé depuis le shell `pivot-ui` une fois ce
 * module intégré (voir `pivot-ui` CLAUDE.md — modules métier lazy-loaded par domaine).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, TranslocoPipe],
  template: `
    <main>
      <h1>{{ 'app.title' | transloco }}</h1>
      <p>{{ 'app.bootstrapNotice' | transloco }}</p>
      <router-outlet />
    </main>
  `,
})
export class App {}
