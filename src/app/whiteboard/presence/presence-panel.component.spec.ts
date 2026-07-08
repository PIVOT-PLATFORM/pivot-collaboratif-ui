import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ParticipantInfo, WhiteboardSyncService } from '../../core/whiteboard/whiteboard-sync.service';
import { PresencePanelComponent } from './presence-panel.component';

/**
 * Lightweight stand-in for `WhiteboardSyncService` — exposes only the public surface this
 * component depends on (`participantsUpdates$`), matching the pattern already used by
 * `whiteboard-presence.component.spec.ts` for the same service.
 */
class FakeSyncService {
  readonly participantsUpdates$ = new Subject<ParticipantInfo[]>();
}

const FR_TRANSLATIONS = {
  whiteboard: {
    presence: {
      cursorLabel: 'Curseur de {{name}}',
      panelAriaLabel: 'Participants en ligne',
      avatarAriaLabel: '{{name}} — {{role}}',
      overflowBadge: '+{{count}}',
      overflowAriaLabel: 'Et {{count}} autres participants : {{names}}',
      online: 'en ligne',
      role: {
        owner: 'Propriétaire',
        editor: 'Éditeur',
        viewer: 'Lecteur',
      },
    },
  },
};

function participant(userId: string, displayName: string, role: string, color = '#000000'): ParticipantInfo {
  return { userId, displayName, avatarUrl: null, color, role };
}

describe('PresencePanelComponent', () => {
  let fixture: ComponentFixture<PresencePanelComponent>;
  let sync: FakeSyncService;

  beforeEach(async () => {
    sync = new FakeSyncService();

    await TestBed.configureTestingModule({
      imports: [
        PresencePanelComponent,
        TranslocoTestingModule.forRoot({
          langs: { fr: FR_TRANSLATIONS },
          translocoConfig: { defaultLang: 'fr', availableLangs: ['fr'] },
          preloadLangs: true,
        }),
      ],
      providers: [{ provide: WhiteboardSyncService, useValue: sync }],
    }).compileComponents();

    fixture = TestBed.createComponent(PresencePanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  function update(...participants: ParticipantInfo[]): void {
    sync.participantsUpdates$.next(participants);
    fixture.detectChanges();
  }

  function avatars(): NodeListOf<HTMLLIElement> {
    return fixture.nativeElement.querySelectorAll('.pp-avatar:not(.pp-avatar--overflow)');
  }

  function overflowBadge(): HTMLLIElement | null {
    return fixture.nativeElement.querySelector('.pp-avatar--overflow');
  }

  // ── Panel-level accessibility ──

  it('has aria-label="Participants en ligne" on the panel', () => {
    const panel = fixture.nativeElement.querySelector('.pp-panel');
    expect(panel.getAttribute('aria-label')).toBe('Participants en ligne');
  });

  it('renders nothing in the avatar list when there are no participants yet', () => {
    expect(avatars()).toHaveLength(0);
    expect(overflowBadge()).toBeNull();
  });

  // ── 1 user ──

  it('renders a single avatar for one connected participant, with its server-assigned colour', () => {
    update(participant('u1', 'Alice', 'EDITOR', '#E91E63'));

    expect(avatars()).toHaveLength(1);
    const avatar = avatars()[0];
    expect(avatar.style.background).toBe('rgb(233, 30, 99)'); // #E91E63
    expect(avatar.querySelector('.pp-avatar__initials')?.textContent?.trim()).toBe('AL');
  });

  it('sets each avatar aria-label to "[displayName] — [rôle]"', () => {
    update(participant('u1', 'Alice Dupont', 'EDITOR'));

    expect(avatars()[0].getAttribute('aria-label')).toBe('Alice Dupont — Éditeur');
  });

  it('labels a VIEWER participant with "Lecteur"', () => {
    update(participant('u1', 'Bob', 'VIEWER'));

    expect(avatars()[0].getAttribute('aria-label')).toBe('Bob — Lecteur');
  });

  it('shows the online count label next to the avatar stack', () => {
    update(participant('u1', 'Alice', 'EDITOR'), participant('u2', 'Bob', 'VIEWER'));

    const label = fixture.nativeElement.querySelector('.pp-online-label');
    expect(label.textContent).toContain('2');
    expect(label.textContent).toContain('en ligne');
  });

  // ── 5 users — exactly at the limit, no overflow ──

  it('renders all 5 avatars with no overflow badge when there are exactly 5 participants', () => {
    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
    );

    expect(avatars()).toHaveLength(5);
    expect(overflowBadge()).toBeNull();
  });

  // ── Overflow ──

  it('collapses participants beyond the first 5 into a "+N" overflow badge', () => {
    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
      participant('u6', 'Farid', 'EDITOR'),
      participant('u7', 'Gaëlle', 'VIEWER'),
    );

    expect(avatars()).toHaveLength(5);
    const badge = overflowBadge();
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.trim()).toBe('+2');
  });

  it('sets the overflow aria-label to "Et [N] autres participants : [liste des noms]"', () => {
    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
      participant('u6', 'Farid', 'EDITOR'),
      participant('u7', 'Gaëlle', 'VIEWER'),
    );

    expect(overflowBadge()?.getAttribute('aria-label')).toBe(
      'Et 2 autres participants : Farid, Gaëlle',
    );
  });

  it('lists the overflowed names in the native hover tooltip', () => {
    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
      participant('u6', 'Farid', 'EDITOR'),
      participant('u7', 'Gaëlle', 'VIEWER'),
    );

    expect(overflowBadge()?.getAttribute('title')).toBe('Farid, Gaëlle');
  });

  // ── Déconnexion ──

  it('removes an avatar and shrinks the count when a participant disconnects', () => {
    update(participant('u1', 'Alice', 'EDITOR'), participant('u2', 'Bob', 'VIEWER'));
    expect(avatars()).toHaveLength(2);

    update(participant('u1', 'Alice', 'EDITOR')); // Bob left

    expect(avatars()).toHaveLength(1);
    expect(avatars()[0].getAttribute('aria-label')).toBe('Alice — Éditeur');
    const label = fixture.nativeElement.querySelector('.pp-online-label');
    expect(label.textContent).toContain('1');
  });

  it('collapses the overflow badge back once the participant count drops to 5 or fewer', () => {
    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
      participant('u6', 'Farid', 'EDITOR'),
    );
    expect(overflowBadge()).not.toBeNull();

    update(
      participant('u1', 'Alice', 'EDITOR'),
      participant('u2', 'Bob', 'VIEWER'),
      participant('u3', 'Chloé', 'EDITOR'),
      participant('u4', 'David', 'VIEWER'),
      participant('u5', 'Eve', 'OWNER'),
    ); // Farid left

    expect(overflowBadge()).toBeNull();
    expect(avatars()).toHaveLength(5);
  });

  // ── Defensive fallback ──

  it('falls back to "?" initials when displayName is blank (defensive, malformed payload)', () => {
    update(participant('u1', '   ', 'EDITOR'));

    expect(avatars()[0].querySelector('.pp-avatar__initials')?.textContent?.trim()).toBe('?');
  });

  // ── Security / XSS ──

  it('renders displayName as escaped text — never as markup (XSS, security AC)', () => {
    update(participant('u1', '<img src=x onerror=alert(1)>', 'EDITOR'));

    const avatar = avatars()[0];
    expect(avatar.querySelector('img[src="x"]')).toBeNull();
    expect(avatar.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)>');
  });

  // ── Cleanup ──

  it('unsubscribes from participantsUpdates$ on destroy', () => {
    update(participant('u1', 'Alice', 'EDITOR'));
    fixture.destroy();

    expect(() => sync.participantsUpdates$.next([participant('u2', 'Bob', 'VIEWER')])).not.toThrow();
  });
});
