import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardFieldValuesPanelComponent } from './card-field-values-panel.component';
import { BoardStore } from '../../core/whiteboard/board.store';
import { BoardTransport } from '../../core/whiteboard/board-transport';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';
import type { BoardField, Card, FieldValue } from '../model/board.types';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-1';
const CARD_ID = 'card-1';

const FR = {
  whiteboard: {
    fieldValue: {
      title: 'Valeurs des champs',
      close: 'Fermer le panneau des valeurs',
      empty: 'Aucun champ défini sur ce tableau.',
      none: '— aucune —',
      valueFor: 'Valeur du champ {{name}}',
      clear: 'Effacer la valeur du champ {{name}}',
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

function baseCard(overrides: Partial<Card> = {}): Card {
  return {
    id: CARD_ID,
    boardId: BOARD_ID,
    type: 'TEXT',
    content: 'hi',
    meta: null,
    posX: 0,
    posY: 0,
    width: 192,
    height: 128,
    color: '#FFEB3B',
    groupId: null,
    groupColor: null,
    locked: false,
    layer: 1,
    fieldValues: [],
    ...overrides,
  };
}

function fieldValue(overrides: Partial<FieldValue> = {}): FieldValue {
  return { id: 'fv-1', cardId: CARD_ID, fieldId: 'field-1', value: 'high', ...overrides };
}

describe('CardFieldValuesPanelComponent', () => {
  let fixture: ComponentFixture<CardFieldValuesPanelComponent>;
  let store: BoardStore;
  let transport: FakeTransport;
  let httpMock: HttpTestingController;

  /** Flushes the four read-only GETs `BoardStore.init()` fires, registering inbound handlers. */
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

  async function createWith(card: Card): Promise<void> {
    fixture = TestBed.createComponent(CardFieldValuesPanelComponent);
    fixture.componentRef.setInput('card', card);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CardFieldValuesPanelComponent,
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
  });

  afterEach(() => {
    httpMock.verify();
  });

  function q<T extends HTMLElement>(sel: string): T {
    return fixture.nativeElement.querySelector(sel) as T;
  }

  function lastEmitOfType(type: string): { type: string; data: Record<string, unknown> } | undefined {
    return [...transport.emitted].reverse().find((e) => e.type === type) as
      | { type: string; data: Record<string, unknown> }
      | undefined;
  }

  it('renders an empty state when the board defines no field', async () => {
    store.fields.set([]);
    await createWith(baseCard());

    expect(q('.wb-cardfields__empty')).not.toBeNull();
    expect(q('.wb-cardfields__list')).toBeNull();
  });

  it('editing a TEXT field emits cardfield:set with the right payload', async () => {
    store.fields.set([baseField()]);
    await createWith(baseCard());

    const input = q<HTMLInputElement>('#wb-fv-field-1');
    input.value = 'Urgent';
    input.dispatchEvent(new Event('change'));

    const emit = lastEmitOfType('cardfield:set');
    expect(emit?.data).toMatchObject({
      boardId: BOARD_ID,
      cardId: CARD_ID,
      fieldId: 'field-1',
      value: 'Urgent',
    });
  });

  it('emptying a TEXT field emits cardfield:clear', async () => {
    store.fields.set([baseField()]);
    await createWith(baseCard({ fieldValues: [fieldValue({ value: 'Urgent' })] }));

    const input = q<HTMLInputElement>('#wb-fv-field-1');
    input.value = '';
    input.dispatchEvent(new Event('change'));

    const emit = lastEmitOfType('cardfield:clear');
    expect(emit?.data).toMatchObject({ boardId: BOARD_ID, cardId: CARD_ID, fieldId: 'field-1' });
  });

  it('the per-field clear button emits cardfield:clear', async () => {
    store.fields.set([baseField()]);
    await createWith(baseCard({ fieldValues: [fieldValue({ value: 'Urgent' })] }));

    q<HTMLButtonElement>('.wb-cardfields__clear').click();

    const emit = lastEmitOfType('cardfield:clear');
    expect(emit?.data).toMatchObject({ cardId: CARD_ID, fieldId: 'field-1' });
  });

  it('a SELECT field renders its options plus a "none" choice and emits on selection', async () => {
    store.fields.set([baseField({ type: 'SELECT', options: ['Bas', 'Haut'] })]);
    await createWith(baseCard());

    const select = q<HTMLSelectElement>('#wb-fv-field-1');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['', 'Bas', 'Haut']);

    select.value = 'Haut';
    select.dispatchEvent(new Event('change'));

    const emit = lastEmitOfType('cardfield:set');
    expect(emit?.data).toMatchObject({ fieldId: 'field-1', value: 'Haut' });
  });

  it('choosing the SELECT "none" option emits cardfield:clear', async () => {
    store.fields.set([baseField({ type: 'SELECT', options: ['Bas', 'Haut'] })]);
    await createWith(baseCard({ fieldValues: [fieldValue({ value: 'Haut' })] }));

    const select = q<HTMLSelectElement>('#wb-fv-field-1');
    select.value = '';
    select.dispatchEvent(new Event('change'));

    const emit = lastEmitOfType('cardfield:clear');
    expect(emit?.data).toMatchObject({ fieldId: 'field-1' });
  });

  it('a VIEWER sees values read-only and cannot edit', async () => {
    store.userRole.set('VIEWER');
    store.fields.set([baseField()]);
    await createWith(baseCard({ fieldValues: [fieldValue({ value: 'Urgent' })] }));

    // No editable control is rendered, only the read-only value.
    expect(q('#wb-fv-field-1')).toBeInstanceOf(HTMLOutputElement);
    expect(q('.wb-cardfields__readonly')?.textContent).toContain('Urgent');
    expect(q('input')).toBeNull();
    expect(q('select')).toBeNull();
    expect(q('.wb-cardfields__clear')).toBeNull();

    // No editing affordance means nothing could have been emitted.
    expect(transport.emitted.some((e) => e.type.startsWith('cardfield:'))).toBe(false);
  });

  it('renders a native control matched to each field type, in schema order', async () => {
    store.fields.set([
      baseField({ id: 'f-num', name: 'Poids', type: 'NUMBER', order: 0 }),
      baseField({ id: 'f-date', name: 'Échéance', type: 'DATE', order: 1 }),
    ]);
    await createWith(baseCard());

    expect(q<HTMLInputElement>('#wb-fv-f-num').type).toBe('number');
    expect(q<HTMLInputElement>('#wb-fv-f-date').type).toBe('date');

    q<HTMLInputElement>('#wb-fv-f-num').value = '42';
    q<HTMLInputElement>('#wb-fv-f-num').dispatchEvent(new Event('change'));

    expect(lastEmitOfType('cardfield:set')?.data).toMatchObject({ fieldId: 'f-num', value: '42' });
  });

  it('emits close from the header close button', async () => {
    store.fields.set([baseField()]);
    await createWith(baseCard());

    const closed: boolean[] = [];
    fixture.componentInstance.close.subscribe(() => closed.push(true));
    q<HTMLButtonElement>('.wb-cardfields__close').click();

    expect(closed).toEqual([true]);
  });

  it('reflects an inbound cardfield:updated broadcast in the shown value', async () => {
    store.fields.set([baseField()]);
    const card = baseCard();
    // Seed the store so the inbound handler can find & update this card.
    store.cards.set([card]);
    await createWith(card);

    expect(q<HTMLInputElement>('#wb-fv-field-1').value).toBe('');

    transport.dispatch('cardfield:updated', fieldValue({ value: 'Depuis un pair' }));
    // The store re-creates the card object; re-project the updated card into the input.
    fixture.componentRef.setInput('card', store.cards()[0]);
    fixture.detectChanges();

    expect(q<HTMLInputElement>('#wb-fv-field-1').value).toBe('Depuis un pair');
  });
});
