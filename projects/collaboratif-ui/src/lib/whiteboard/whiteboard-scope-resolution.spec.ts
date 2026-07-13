import { Component, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideTransloco, Translation, TranslocoLoader, TranslocoPipe } from '@jsverse/transloco';
import { provideCollaboratifUi } from '../core/whiteboard/config/provide-collaboratif-ui';

// Loader global stub : le test n'exerce que des clés du scope whiteboard (chargées par
// provideCollaboratifUi via son InlineLoader) — le catalogue global reste vide. La lib ne
// doit PAS dépendre du loader du harnais.
@Injectable({ providedIn: 'root' })
class EmptyGlobalLoader implements TranslocoLoader {
  getTranslation() {
    return of({} as Translation);
  }
}

@Component({
  standalone: true,
  imports: [TranslocoPipe],
  template: `<span data-test>{{ 'whiteboard.board.untitled' | transloco }}</span>`,
})
class HostComponent {}

/**
 * Sous CD zoneless (ce repo), `fixture.whenStable()` ne suit pas la promesse de chargement
 * du scope whiteboard (import() dynamique du loader, non enregistré comme "pending task"
 * Angular par Transloco) — elle se résout avant que le scope ne soit chargé et que le pipe
 * ne re-rende. On attend donc explicitement, par polling borné, que le DOM reflète une valeur
 * stable (non vide) plutôt qu'un délai fixe arbitraire.
 */
async function waitForNonEmptyText(
  fixture: import('@angular/core/testing').ComponentFixture<HostComponent>,
  selector: string,
  maxAttempts = 20,
  intervalMs = 25,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector(selector).textContent.trim();
    if (text.length > 0) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return fixture.nativeElement.querySelector(selector).textContent.trim();
}

describe('résolution du scope whiteboard', () => {
  it('résout whiteboard.board.untitled sans rendre la clé brute', async () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: { availableLangs: ['fr', 'en'], defaultLang: 'fr', reRenderOnLangChange: true },
          loader: EmptyGlobalLoader,
        }),
        provideCollaboratifUi({ apiUrl: '/api/collaboratif' }),
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = await waitForNonEmptyText(fixture, '[data-test]');

    expect(text).not.toMatch(/^whiteboard\./);
    expect(text.length).toBeGreaterThan(0);
  });
});
