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
import { TranslocoPipe } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';
import { ToastService } from '../../core/toast/toast.service';
import { BoardMember, ShareToken } from '../../core/whiteboard/board.model';

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

  /** Emitted when the user closes the panel (Escape or close button). */
  readonly closed = output<void>();

  private readonly boardService = inject(BoardService);
  private readonly toast = inject(ToastService);

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
