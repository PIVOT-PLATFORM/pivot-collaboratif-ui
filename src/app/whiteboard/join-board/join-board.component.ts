import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BoardService } from '../../core/whiteboard/board.service';

/** Error-code to i18n-key mapping for join failures. */
const ERROR_KEYS: Record<number, string> = {
  401: 'whiteboard.join.error401',
  403: 'whiteboard.join.error403',
  404: 'whiteboard.join.error404',
  409: 'whiteboard.join.error409',
  410: 'whiteboard.join.error410',
  429: 'whiteboard.join.error429',
};

/**
 * Page component for the `/whiteboard/join?token=...` route (US08.2.3).
 *
 * On init, reads the `token` query parameter and calls the join endpoint.
 * On success, navigates to the board. On failure, shows an error message
 * with a retry button.
 */
@Component({
  selector: 'app-join-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './join-board.component.html',
  styleUrl: './join-board.component.scss',
})
export class JoinBoardComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly boardService = inject(BoardService);
  private readonly transloco = inject(TranslocoService);

  protected readonly status = signal<'loading' | 'error'>('loading');
  protected readonly errorCode = signal<number | null>(null);
  private token = '';

  protected readonly errorMessage = computed(() => {
    const code = this.errorCode();
    const key = code !== null
      ? (ERROR_KEYS[code] ?? 'whiteboard.join.errorDefault')
      : 'whiteboard.join.errorDefault';
    return this.transloco.translate(key);
  });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.token = params.get('token') ?? '';
      this.join();
    });
  }

  protected retry(): void {
    this.status.set('loading');
    this.join();
  }

  private join(): void {
    if (!this.token) {
      this.errorCode.set(400);
      this.status.set('error');
      return;
    }

    this.boardService.joinBoard(this.token).subscribe({
      next: result => {
        this.router.navigateByUrl(result.redirectUrl);
      },
      error: (err: HttpErrorResponse) => {
        this.errorCode.set(err.status);
        this.status.set('error');
      },
    });
  }
}
