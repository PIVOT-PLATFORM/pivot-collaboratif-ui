import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/** Preset durations (minutes) offered as one-tap chips (US08.12.1). */
export const TIMER_PRESETS_MIN: readonly number[] = [1, 3, 5, 10, 15];

/** Bounds for the custom duration, mirroring the backend's ephemeral-timer expectations. */
const MIN_SECONDS = 5;
const MAX_SECONDS = 60 * 60; // 1 hour

/**
 * Owner/editor dialog to configure and start the board's shared facilitation timer (US08.12.1).
 *
 * Purely presentational: it emits {@link start} with the chosen duration in seconds, or
 * {@link close}. The host ({@link import('../board-page/board-page.component').BoardPageComponent})
 * relays {@code start} to {@code BoardStore.startTimer(seconds)}, which broadcasts {@code
 * timer:start} over STOMP to the whole room.
 *
 * `role="dialog" aria-modal="true"` with Escape-to-close and focus placed on the first preset.
 */
@Component({
  selector: 'wb-timer-config-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './timer-config-dialog.component.html',
  styleUrl: './timer-config-dialog.component.scss',
})
export class TimerConfigDialogComponent {
  /** Emits the selected duration in seconds. */
  readonly start = output<number>();
  /** Emits when the dialog is dismissed without starting. */
  readonly close = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly presets = TIMER_PRESETS_MIN;
  /** Custom-duration fields, pre-filled to a sensible 5-minute default. */
  protected readonly customMin = signal(5);
  protected readonly customSec = signal(0);

  protected onCustomMinInput(event: Event): void {
    this.customMin.set(this.clampInt((event.target as HTMLInputElement).value, 0, 60));
  }

  protected onCustomSecInput(event: Event): void {
    this.customSec.set(this.clampInt((event.target as HTMLInputElement).value, 0, 59));
  }

  /** Total custom duration in seconds, clamped to the allowed range. */
  protected customSeconds(): number {
    const total = this.customMin() * 60 + this.customSec();
    return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, total));
  }

  protected startPreset(minutes: number): void {
    this.start.emit(minutes * 60);
  }

  protected startCustom(): void {
    this.start.emit(this.customSeconds());
  }

  protected onClose(): void {
    this.close.emit();
  }

  @HostListener('keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    event.preventDefault();
    this.onClose();
  }

  private clampInt(raw: string, lo: number, hi: number): number {
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n)) {
      return lo;
    }
    return Math.min(hi, Math.max(lo, n));
  }
}
