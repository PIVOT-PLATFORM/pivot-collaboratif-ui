import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { SharePanelComponent } from './share-panel.component';
import { ToastService } from '../../core/toast/toast.service';
import { BoardMember, ShareToken } from '../../core/whiteboard/board.model';
import { COLLABORATIF_API_URL } from '../../core/whiteboard/config/tokens';

const TEST_API_URL = 'http://localhost:8083/api/collaboratif';
const BOARD_ID = 'board-abc-123';
const MEMBERS_URL = `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members`;
const SHARE_URL = `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/share`;

const FR: Record<string, unknown> = {
  whiteboard: {
    share: {
      panel: {
        title: 'Partager le tableau',
        close: 'Fermer',
        linkSection: 'Lien d\'invitation',
        selectRole: 'Rôle :',
        generateLink: 'Générer un lien',
        generatingLink: 'Génération…',
        linkLabel: 'Lien',
        copyLink: 'Copier le lien',
        linkCopied: 'Lien copié !',
        clipboardFallback: 'Copiez manuellement.',
        generateError: 'Erreur génération',
        membersSection: 'Membres',
        memberUserId: 'ID',
        memberRole: 'Rôle',
        memberJoined: 'Date',
        changeRole: 'Changer le rôle',
        removeMember: 'Retirer',
        removeError: 'Erreur suppression',
        roleUpdateError: 'Erreur rôle',
        loadMembersError: 'Erreur membres',
        confirmRemove: {
          title: 'Retirer ce membre ?',
          message: 'Accès perdu.',
          confirm: 'Confirmer',
          cancel: 'Annuler',
        },
      },
      invite: {
        section: 'Inviter par email',
        emailLabel: 'Adresse email',
        emailPlaceholder: 'personne@exemple.fr',
        roleLabel: 'Rôle',
        submit: 'Inviter',
        submitting: 'Invitation…',
        success: 'Invitation envoyée.',
      },
      error: {
        invalidEmail: 'Adresse email invalide.',
        unknownEmail: 'Aucun utilisateur ne correspond à cette adresse email.',
        selfInvite: 'Vous ne pouvez pas vous inviter vous-même.',
        creatorInvite: 'Cet utilisateur est déjà propriétaire du tableau.',
        forbiddenRole: 'Un éditeur ne peut pas attribuer le rôle propriétaire.',
        generic: 'L\'invitation a échoué. Réessayez.',
      },
    },
  },
};

const OWNER: BoardMember = {
  userId: 'user-owner-aaaa-aaaa-aaaaaaaaaaaa',
  role: 'OWNER',
  joinedAt: '2026-07-01T00:00:00Z',
};

const EDITOR: BoardMember = {
  userId: 'user-edit-bbbb-bbbb-bbbbbbbbbbbb',
  role: 'EDITOR',
  joinedAt: '2026-07-02T00:00:00Z',
};

const TOKEN: ShareToken = {
  id: 'tok-1',
  token: 'abc123def456',
  role: 'EDITOR',
  maxUses: 10,
  expiresAt: '2026-08-01T00:00:00Z',
};

describe('SharePanelComponent', () => {
  let fixture: ComponentFixture<SharePanelComponent>;
  let httpMock: HttpTestingController;
  let toastService: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SharePanelComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: COLLABORATIF_API_URL, useValue: TEST_API_URL },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharePanelComponent);
    fixture.componentRef.setInput('boardId', BOARD_ID);
    httpMock = TestBed.inject(HttpTestingController);
    toastService = TestBed.inject(ToastService);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
  });

  // ── Loading state ──
  it('shows loading spinner while members are being fetched', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[aria-busy="true"]')).toBeTruthy();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();
  });

  // ── Members loaded ──
  it('renders member rows on successful load', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.share-panel__tr');
    expect(rows.length).toBe(2);
    // OWNER badge present
    expect(fixture.nativeElement.querySelector('.share-panel__role-badge--owner')).toBeTruthy();
    // EDITOR gets a role select (non-owner)
    expect(fixture.nativeElement.querySelector(`#role-${EDITOR.userId}`)).toBeTruthy();
  });

  // ── Error loading members ──
  it('shows error message when member list fails to load', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.textContent).toContain('Erreur membres');
  });

  // ── Owner has no remove button ──
  it('owner row has no remove button', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.share-panel__remove-btn')).toBeNull();
  });

  // ── Non-owner row has remove button ──
  it('non-owner row has remove button', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.share-panel__remove-btn')).toBeTruthy();
  });

  // ── Generate link ──
  it('generate link button sends POST and shows the invitation link', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.share-panel__generate-btn') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();

    const req = httpMock.expectOne(r => r.url === SHARE_URL && r.method === 'POST');
    expect(req.request.body).toEqual({ role: 'EDITOR' });
    req.flush(TOKEN);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(TOKEN.token);
  });

  // ── Generate link error ──
  it('shows toast when link generation fails', () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__generate-btn').click();
    fixture.detectChanges();

    httpMock.expectOne(r => r.url === SHARE_URL && r.method === 'POST')
      .flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.share.panel.generateError', 'error');
  });

  // ── Copy link — clipboard available ──
  it('sets linkCopied after successful clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__generate-btn').click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === SHARE_URL).flush(TOKEN);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__copy-btn').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Lien copié !');
  });

  // ── Copy link — clipboard unavailable → fallback input ──
  it('shows fallback readonly input when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__generate-btn').click();
    fixture.detectChanges();
    httpMock.expectOne(r => r.url === SHARE_URL).flush(TOKEN);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__copy-btn').click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.share-panel__link-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.readOnly).toBe(true);
    expect(input.value).toContain(TOKEN.token);
  });

  // ── Role change ──
  it('sends PATCH on role select change and updates member in list', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(`#role-${EDITOR.userId}`) as HTMLSelectElement;
    select.value = 'VIEWER';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const req = httpMock.expectOne(
      r => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members/${EDITOR.userId}/role` && r.method === 'PATCH',
    );
    expect(req.request.body).toEqual({ role: 'VIEWER' });
    req.flush({ ...EDITOR, role: 'VIEWER' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(`#role-${EDITOR.userId}`)).toBeTruthy();
  });

  // ── Role change error ──
  it('shows toast on role update failure', () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(`#role-${EDITOR.userId}`) as HTMLSelectElement;
    select.value = 'VIEWER';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    httpMock.expectOne(
      r => r.url.includes(`/members/${EDITOR.userId}/role`) && r.method === 'PATCH',
    ).flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.share.panel.roleUpdateError', 'error');
  });

  // ── Remove member — confirm dialog opens ──
  it('clicking remove opens the confirm alertdialog', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__remove-btn').click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="alertdialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Retirer ce membre ?');
  });

  // ── Remove member — cancel ──
  it('cancel in confirm dialog closes dialog without HTTP call', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__remove-btn').click();
    fixture.detectChanges();

    const cancelBtn = fixture.nativeElement.querySelector('.share-panel__dialog-btn--cancel') as HTMLButtonElement;
    cancelBtn.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.share-panel__remove-btn')).toBeTruthy();
  });

  // ── Remove member — success ──
  it('confirms remove: sends DELETE and removes member from list', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__remove-btn').click();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__dialog-btn--confirm').click();
    fixture.detectChanges();

    httpMock.expectOne(
      r => r.url === `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/members/${EDITOR.userId}` && r.method === 'DELETE',
    ).flush(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fixture.nativeElement.querySelector(`#role-${EDITOR.userId}`)).toBeNull();
  });

  // ── Remove member — error ──
  it('shows toast on remove failure', () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER, EDITOR]);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.share-panel__remove-btn').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.share-panel__dialog-btn--confirm').click();
    fixture.detectChanges();

    httpMock.expectOne(
      r => r.url.includes(`/members/${EDITOR.userId}`) && r.method === 'DELETE',
    ).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();

    expect(toastSpy).toHaveBeenCalledWith('whiteboard.share.panel.removeError', 'error');
  });

  // ── Close button ──
  it('close button emits closed event', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([]);
    fixture.detectChanges();

    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => { emitted = true; });

    fixture.nativeElement.querySelector('.share-panel__close-btn').click();
    expect(emitted).toBe(true);
  });

  // ── Escape key ──
  it('Escape key emits closed event', () => {
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([]);
    fixture.detectChanges();

    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => { emitted = true; });

    const panel = fixture.nativeElement.querySelector('.share-panel') as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(emitted).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Invite by e-mail (US08.2.5)
  // ─────────────────────────────────────────────────────────────────────

  const INVITE_URL = `${TEST_API_URL}/whiteboard/boards/${BOARD_ID}/shares/invite`;

  function initPanel(managerRole?: 'OWNER' | 'EDITOR' | 'VIEWER'): void {
    if (managerRole) {
      fixture.componentRef.setInput('managerRole', managerRole);
    }
    fixture.detectChanges();
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    fixture.detectChanges();
  }

  function setEmail(value: string): void {
    const input = fixture.nativeElement.querySelector('#share-invite-email') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submitForm(): void {
    const form = fixture.nativeElement.querySelector('.share-panel__invite-form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();
  }

  it('renders the invite form with an e-mail input and a role select', () => {
    initPanel();
    expect(fixture.nativeElement.querySelector('#share-invite-email')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#share-invite-role')).toBeTruthy();
  });

  it('EDITOR manager role select never exposes OWNER', () => {
    initPanel('EDITOR');
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#share-invite-role option'),
    ).map(o => (o as HTMLOptionElement).value);
    expect(options).toEqual(['VIEWER', 'EDITOR']);
  });

  it('OWNER manager role select exposes OWNER', () => {
    initPanel('OWNER');
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#share-invite-role option'),
    ).map(o => (o as HTMLOptionElement).value);
    expect(options).toContain('OWNER');
  });

  it('submitting a valid invite POSTs to /shares/invite and shows a success toast', () => {
    const toastSpy = vi.spyOn(toastService, 'show');
    initPanel('OWNER');
    setEmail('invitee@example.com');
    submitForm();

    const req = httpMock.expectOne(r => r.url === INVITE_URL && r.method === 'POST');
    expect(req.request.body).toEqual({ email: 'invitee@example.com', role: 'VIEWER' });
    req.flush({ shareId: 's1', userId: 'u1', role: 'VIEWER', joinedAt: '2026-07-17T00:00:00Z' });
    fixture.detectChanges();

    // Success reloads the members list.
    httpMock.expectOne(MEMBERS_URL).flush([OWNER]);
    expect(toastSpy).toHaveBeenCalledWith('whiteboard.share.invite.success', 'success');
  });

  it('empty e-mail shows a validation error without any HTTP call', () => {
    initPanel();
    setEmail('   ');
    submitForm();
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Adresse email invalide.');
  });

  it('unknown e-mail (404) announces the unknown-email error via role="alert"', () => {
    initPanel();
    setEmail('nobody@example.com');
    submitForm();
    httpMock.expectOne(INVITE_URL).flush(
      { code: 'INVITEE_NOT_FOUND' },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('Aucun utilisateur');
  });

  it('self-invitation (400 SELF_INVITE) announces the self-invite error', () => {
    initPanel();
    setEmail('me@example.com');
    submitForm();
    httpMock.expectOne(INVITE_URL).flush(
      { code: 'SELF_INVITE' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('vous inviter vous-même');
  });

  it('creator invitation (400 ALREADY_OWNER) announces the creator error', () => {
    initPanel();
    setEmail('owner@example.com');
    submitForm();
    httpMock.expectOne(INVITE_URL).flush(
      { code: 'ALREADY_OWNER' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('déjà propriétaire');
  });

  it('forbidden role (403) announces the forbidden-role error', () => {
    initPanel('EDITOR');
    setEmail('someone@example.com');
    submitForm();
    httpMock.expectOne(INVITE_URL).flush('', { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('éditeur ne peut pas attribuer');
  });

  it('network/server error (500) announces the generic error', () => {
    initPanel();
    setEmail('someone@example.com');
    submitForm();
    httpMock.expectOne(INVITE_URL).flush('', { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('invitation a échoué');
  });
});
