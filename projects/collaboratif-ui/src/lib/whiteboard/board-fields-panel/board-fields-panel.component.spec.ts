import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardFieldsPanelComponent } from './board-fields-panel.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';
import type { BoardField } from '../model/board.types';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';

const FR = {
  whiteboard: {
    field: {
      title: 'Champs personnalisés',
      close: 'Fermer',
      empty: 'Aucun champ défini sur ce tableau.',
      name: 'Nom',
      namePlaceholder: 'Nom du champ',
      emoji: 'Emoji',
      type: { label: 'Type', text: 'Texte', number: 'Nombre', date: 'Date', select: 'Liste de choix' },
      typeLocked: 'Le type ne peut pas être modifié.',
      options: 'Options',
      addOption: 'Ajouter une option',
      optionPlaceholder: 'Nouvelle option',
      removeOption: 'Retirer {{value}}',
      create: 'Créer le champ',
      createTitle: 'Nouveau champ',
      edit: 'Modifier {{name}}',
      editTitle: 'Modifier le champ',
      save: 'Enregistrer',
      cancel: 'Annuler',
      delete: 'Supprimer {{name}}',
      confirmDelete: 'Confirmer la suppression de {{name}}',
      deleteWarning: 'Supprimer ce champ efface ses valeurs.',
    },
  },
};

/** Minimal {@link BoardTransport} double recording emits and dispatching inbound broadcasts. */
class FakeTransport extends BoardTransport {
  readonly emitted: { type: string; data: unknown }[] = [];
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

  connect(): void {}
  disconnect(): void {}

  emit(type: string, data: unknown): void {
    this.emitted.push({ type, data });
  }

  on<T = unknown>(type: string, handler: (data: T) => void): () => void {
    const set = this.handlers.get(type) ?? new Set<(data: unknown) => void>();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (data: unknown) => void);
  }

  onReconnect(): () => void {
    return () => {};
  }

  getSessionId(): string {
    return 'my-session-id';
  }

  dispatch<T>(type: string, data: T): void {
    this.handlers.get(type)?.forEach((h) => h(data));
  }
}

function baseField(overrides: Partial<BoardField> = {}): BoardField {
  return {
    id: 'field-1',
    boardId: BOARD_ID,
    name: 'Priorité',
    emoji: '🔥',
    type: 'TEXT',
    options: null,
    order: 0,
    ...overrides,
  };
}

describe('BoardFieldsPanelComponent', () => {
  let fixture: ComponentFixture<BoardFieldsPanelComponent>;
  let store: BoardStore;
  let transport: FakeTransport;
  let httpMock: HttpTestingController;

  /** Flushes the four read-only GETs `BoardStore.init()` fires, registering the inbound handlers. */
  async function flushInit(): Promise<void> {
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}`).flush({
      id: BOARD_ID,
      title: 'Board',
      description: null,
      coverImage: null,
      maxParticipants: null,
      enabledActivities: [],
      role: 'OWNER',
    });
    httpMock.expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`).flush([]);
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/current`)
      .flush('', { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((r) => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/vote/last`)
      .flush('', { status: 404, statusText: 'Not Found' });
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        BoardFieldsPanelComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        BoardStore,
        { provide: BoardTransport, useClass: FakeTransport },
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigateByUrl: vi.fn().mockResolvedValue(true) } },
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    }).compileComponents();

    store = TestBed.inject(BoardStore);
    transport = TestBed.inject(BoardTransport) as unknown as FakeTransport;
    httpMock = TestBed.inject(HttpTestingController);
    store.init(BOARD_ID);
    await flushInit();

    fixture = TestBed.createComponent(BoardFieldsPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  function q<T extends HTMLElement>(sel: string): T {
    return fixture.nativeElement.querySelector(sel) as T;
  }

  function setInput(sel: string, value: string): void {
    const el = q<HTMLInputElement>(sel);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function lastEmitOfType(type: string): { type: string; data: Record<string, unknown> } | undefined {
    return [...transport.emitted].reverse().find((e) => e.type === type) as
      | { type: string; data: Record<string, unknown> }
      | undefined;
  }

  it('creates a TEXT field, emitting boardfield:create with the right payload', () => {
    setInput('#wb-field-name', 'Priorité');
    setInput('#wb-field-emoji', '🔥');

    q<HTMLButtonElement>('.wb-fields__btn--primary').click();

    const emit = lastEmitOfType('boardfield:create');
    expect(emit).toBeDefined();
    expect(emit?.data).toMatchObject({
      boardId: BOARD_ID,
      name: 'Priorité',
      type: 'TEXT',
      emoji: '🔥',
      options: null,
      order: 0,
    });
  });

  it('shows the options editor only for SELECT, hidden for other types', () => {
    expect(q('.wb-fields__options-editor')).toBeNull();

    const select = q<HTMLSelectElement>('#wb-field-type');
    select.value = 'SELECT';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(q('.wb-fields__options-editor')).not.toBeNull();
  });

  it('creates a SELECT field with its options', () => {
    setInput('#wb-field-name', 'Statut');
    const select = q<HTMLSelectElement>('#wb-field-type');
    select.value = 'SELECT';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    setInput('#wb-field-option', 'À faire');
    q<HTMLButtonElement>('.wb-fields__opt-add .wb-fields__btn--ghost').click();
    fixture.detectChanges();
    setInput('#wb-field-option', 'Fait');
    q<HTMLButtonElement>('.wb-fields__opt-add .wb-fields__btn--ghost').click();
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__btn--primary').click();

    const emit = lastEmitOfType('boardfield:create');
    expect(emit?.data).toMatchObject({ name: 'Statut', type: 'SELECT', options: ['À faire', 'Fait'] });
  });

  it('hides the type control in edit mode and emits boardfield:update', () => {
    store.fields.set([baseField()]);
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__icon-btn:not(.wb-fields__icon-btn--danger)').click();
    fixture.detectChanges();

    // The native type <select> is replaced by a read-only locked display.
    expect(q('#wb-field-type')).toBeNull();
    expect(q('.wb-fields__type-locked')).not.toBeNull();

    setInput('#wb-field-name', 'Priorité haute');
    q<HTMLButtonElement>('.wb-fields__btn--primary').click();

    const emit = lastEmitOfType('boardfield:update');
    expect(emit?.data).toMatchObject({ id: 'field-1', name: 'Priorité haute' });
  });

  it('requires a confirmation step before emitting boardfield:delete', () => {
    store.fields.set([baseField()]);
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__icon-btn--danger').click();
    fixture.detectChanges();

    // First click only arms the inline confirmation — nothing deleted yet.
    expect(lastEmitOfType('boardfield:delete')).toBeUndefined();
    expect(q('.wb-fields__confirm')).not.toBeNull();

    q<HTMLButtonElement>('.wb-fields__confirm .wb-fields__btn--danger').click();

    const emit = lastEmitOfType('boardfield:delete');
    expect(emit?.data).toMatchObject({ id: 'field-1', boardId: BOARD_ID });
  });

  it('emits close from the header close button', () => {
    const component = fixture.componentInstance;
    const closed: boolean[] = [];
    component.close.subscribe(() => closed.push(true));
    q<HTMLButtonElement>('.wb-fields__close').click();
    expect(closed).toEqual([true]);
  });

  it('cancels an edit and returns the form to create mode', () => {
    store.fields.set([baseField()]);
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__icon-btn:not(.wb-fields__icon-btn--danger)').click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>('#wb-field-name').value).toBe('Priorité');

    // The cancel (ghost) button in the form footer only exists in edit mode.
    q<HTMLButtonElement>('.wb-fields__form-actions .wb-fields__btn--ghost').click();
    fixture.detectChanges();

    expect(q<HTMLInputElement>('#wb-field-name').value).toBe('');
    expect(q('#wb-field-type')).not.toBeNull();
  });

  it('dismisses the delete confirmation without deleting', () => {
    store.fields.set([baseField()]);
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__icon-btn--danger').click();
    fixture.detectChanges();

    q<HTMLButtonElement>('.wb-fields__confirm .wb-fields__btn--ghost').click();
    fixture.detectChanges();

    expect(q('.wb-fields__confirm')).toBeNull();
    expect(lastEmitOfType('boardfield:delete')).toBeUndefined();
  });

  it('adds and removes SELECT options and ignores duplicates', () => {
    const select = q<HTMLSelectElement>('#wb-field-type');
    select.value = 'SELECT';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    setInput('#wb-field-option', 'A');
    q<HTMLButtonElement>('.wb-fields__opt-add .wb-fields__btn--ghost').click();
    fixture.detectChanges();
    // Duplicate is ignored — still a single option row.
    setInput('#wb-field-option', 'A');
    q<HTMLButtonElement>('.wb-fields__opt-add .wb-fields__btn--ghost').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-fields__opt-row').length).toBe(1);

    // Remove it.
    q<HTMLButtonElement>('.wb-fields__opt-row .wb-fields__icon-btn--danger').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.wb-fields__opt-row').length).toBe(0);
  });

  it('renders a field pushed via an inbound boardfield:created broadcast', () => {
    expect(fixture.nativeElement.textContent).toContain('Aucun champ');

    transport.dispatch('boardfield:created', baseField({ id: 'field-x', name: 'Échéance', type: 'DATE' }));
    fixture.detectChanges();

    const names = Array.from(fixture.nativeElement.querySelectorAll('.wb-fields__name')).map((e) =>
      (e as HTMLElement).textContent?.trim(),
    );
    expect(names).toContain('Échéance');
  });
});
