import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DatePipe, SlicePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { BoardMember, ShareToken } from '../../core/whiteboard/board.model';

/** Role a share may be granted through the invite form. */
type InviteRole = 'OWNER' | 'EDITOR' | 'VIEWER';

/**
 * Panel component for board sharing and member management (US08.2.3).
 *
 * Supports: generating an invitation link, copying it to the clipboard,
 * listing members with their roles, changing a member's role, and
 * revoking a member with a confirmation dialog.
 *
 * Must be used inside a `role="dialog" aria-modal="true"` host to satisfy
 * the A11y focus-trap requirement.
 */
@Component({
  selector: 'app-share-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe, DatePipe, SlicePipe],
  templateUrl: './share-panel.component.html',
  styleUrl: './share-panel.component.scss',
})
export class SharePanelComponent implements OnInit {
  /** Board whose members and share links are managed by this panel. */
  readonly boardId = input.required<string>();

  /**
   * Role of the current user managing this panel (US08.2.5). Bounds the invite role select:
   * only an OWNER may grant OWNER; an EDITOR never sees the OWNER option. Defaults to the safe
   * `EDITOR` subset. The backend remains the sole authority (defense in depth).
   */
  readonly managerRole = input<'OWNER' | 'EDITOR' | 'VIEWER'>('EDITOR');

  /** Emitted when the user closes the panel (Escape or close button). */
  readonly closed = output<void>();

  private readonly boardService = inject(BoardService);
  private readonly toast = inject(ToastService);

  /** Invite form state (US08.2.5). */
  protected readonly inviteEmail = signal('');
  protected readonly inviteRole = signal<InviteRole>('VIEWER');
  protected readonly inviteStatus = signal<'idle' | 'submitting'>('idle');
  /** i18n key of the current invite error announced via `role="alert"`, or `null`. */
  protected readonly inviteErrorKey = signal<string | null>(null);

  /** Role options the manager may grant — OWNER only when the manager is an OWNER. */
  protected readonly inviteRoleOptions = computed<InviteRole[]>(() =>
    this.managerRole() === 'OWNER' ? ['VIEWER', 'EDITOR', 'OWNER'] : ['VIEWER', 'EDITOR'],
  );

  protected readonly members = signal<BoardMember[]>([]);
  protected readonly membersStatus = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly shareToken = signal<ShareToken | null>(null);
  protected readonly tokenStatus = signal<'idle' | 'generating' | 'error'>('idle');
  protected readonly selectedRole = signal<'EDITOR' | 'VIEWER'>('EDITOR');
  protected readonly linkCopied = signal(false);
  protected readonly clipboardFailed = signal(false);
  protected readonly confirmRemoveMember = signal<BoardMember | null>(null);
  protected readonly updatingRoleForUserId = signal<string | null>(null);
  protected readonly removingMemberId = signal<string | null>(null);

  protected readonly shareLink = computed(() => {
    const t = this.shareToken();
    return t ? `${window.location.origin}/whiteboard/join?token=${t.token}` : null;
  });

  ngOnInit(): void {
    this.loadMembers();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected setSelectedRole(event: Event): void {
    this.selectedRole.set((event.target as HTMLSelectElement).value as 'EDITOR' | 'VIEWER');
  }

  protected generateLink(): void {
    this.tokenStatus.set('generating');
    this.boardService.generateShareToken(this.boardId(), this.selectedRole()).subscribe({
      next: token => {
        this.shareToken.set(token);
        this.tokenStatus.set('idle');
        this.clipboardFailed.set(false);
      },
      error: () => {
        this.tokenStatus.set('error');
        this.toast.show('whiteboard.share.panel.generateError', 'error');
      },
    });
  }

  protected copyLink(): void {
    const link = this.shareLink();
    if (!link) return;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(link).then(
        () => {
          this.linkCopied.set(true);
          setTimeout(() => this.linkCopied.set(false), 2000);
        },
        () => this.clipboardFailed.set(true),
      );
    } else {
      this.clipboardFailed.set(true);
    }
  }

  protected onRoleChange(member: BoardMember, event: Event): void {
    const newRole = (event.target as HTMLSelectElement).value as 'EDITOR' | 'VIEWER';
    this.updatingRoleForUserId.set(member.userId);
    this.boardService.updateMemberRole(this.boardId(), member.userId, newRole).subscribe({
      next: updated => {
        this.members.update(list =>
          list.map(m => (m.userId === member.userId ? { ...m, role: updated.role } : m)),
        );
        this.updatingRoleForUserId.set(null);
      },
      error: () => {
        this.updatingRoleForUserId.set(null);
        this.toast.show('whiteboard.share.panel.roleUpdateError', 'error');
        /* Force signal re-read so the select resets to the server value */
        this.members.update(list => [...list]);
      },
    });
  }

  protected startRemove(member: BoardMember): void {
    this.confirmRemoveMember.set(member);
  }

  protected cancelRemove(): void {
    this.confirmRemoveMember.set(null);
  }

  protected confirmRemove(member: BoardMember): void {
    this.removingMemberId.set(member.userId);
    this.boardService.removeMember(this.boardId(), member.userId).subscribe({
      next: () => {
        this.members.update(list => list.filter(m => m.userId !== member.userId));
        this.removingMemberId.set(null);
        this.confirmRemoveMember.set(null);
      },
      error: () => {
        this.removingMemberId.set(null);
        this.toast.show('whiteboard.share.panel.removeError', 'error');
      },
    });
  }

  protected setInviteEmail(event: Event): void {
    this.inviteEmail.set((event.target as HTMLInputElement).value);
    if (this.inviteErrorKey()) {
      this.inviteErrorKey.set(null);
    }
  }

  protected setInviteRole(event: Event): void {
    this.inviteRole.set((event.target as HTMLSelectElement).value as InviteRole);
  }

  /**
   * Submits the invite form. Guards against an OWNER role the manager cannot grant (the backend
   * is authoritative too), then calls the invite endpoint and maps any error to a localized key
   * announced via `role="alert"`. On success the members list is refreshed and the form reset.
   */
  protected submitInvite(event?: Event): void {
    event?.preventDefault();
    const email = this.inviteEmail().trim();
    if (!email) {
      this.inviteErrorKey.set('whiteboard.share.error.invalidEmail');
      return;
    }
    const role = this.inviteRole();
    if (role === 'OWNER' && this.managerRole() !== 'OWNER') {
      this.inviteErrorKey.set('whiteboard.share.error.forbiddenRole');
      return;
    }

    this.inviteStatus.set('submitting');
    this.inviteErrorKey.set(null);
    this.boardService.inviteByEmail(this.boardId(), email, role).subscribe({
      next: () => {
        this.inviteStatus.set('idle');
        this.inviteEmail.set('');
        this.inviteRole.set('VIEWER');
        this.toast.show('whiteboard.share.invite.success', 'success');
        this.loadMembers();
      },
      error: (err: HttpErrorResponse) => {
        this.inviteStatus.set('idle');
        this.inviteErrorKey.set(this.mapInviteError(err));
      },
    });
  }

  /** Maps an invite HTTP error to the i18n key of the message to announce. */
  private mapInviteError(err: HttpErrorResponse): string {
    const code = (err.error as { code?: string } | null)?.code;
    if (err.status === 404) {
      return 'whiteboard.share.error.unknownEmail';
    }
    if (err.status === 403) {
      return 'whiteboard.share.error.forbiddenRole';
    }
    if (err.status === 400) {
      if (code === 'SELF_INVITE') {
        return 'whiteboard.share.error.selfInvite';
      }
      if (code === 'ALREADY_OWNER') {
        return 'whiteboard.share.error.creatorInvite';
      }
      return 'whiteboard.share.error.invalidEmail';
    }
    return 'whiteboard.share.error.generic';
  }

  private loadMembers(): void {
    this.membersStatus.set('loading');
    this.boardService.listMembers(this.boardId()).subscribe({
      next: list => {
        this.members.set(list);
        this.membersStatus.set('loaded');
      },
      error: () => {
        this.membersStatus.set('error');
      },
    });
  }
}
