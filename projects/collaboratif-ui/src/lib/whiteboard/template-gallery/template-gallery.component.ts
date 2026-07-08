import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { TemplateService } from '../../core/whiteboard/template.service';
import { WhiteboardTemplate } from '../../core/whiteboard/board.model';

/** Template whose code is pre-selected by default when the gallery finishes loading. */
const DEFAULT_TEMPLATE_CODE: WhiteboardTemplate['code'] = 'BRAINSTORM';

/**
 * Template gallery embedded in the "Nouveau tableau" modal (US08.4.1).
 *
 * Fetches the global template catalog (`GET /whiteboard/templates`), renders it as a
 * single-select `listbox` of cards (name, visual preview, description), and emits the
 * selected template id — `null` when no selection is possible (initial/erroring state),
 * meaning the parent falls back to blank ("Vierge") board creation.
 *
 * Keyboard support: arrow keys move focus between cards (roving tabindex), Enter/Space
 * select the focused card (native `<button>` activation).
 */
@Component({
  selector: 'app-template-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoPipe],
  templateUrl: './template-gallery.component.html',
  styleUrl: './template-gallery.component.scss',
})
export class TemplateGalleryComponent implements OnInit {
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly templates = signal<WhiteboardTemplate[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly skeletons = Array.from<null>({ length: 3 });

  /** Emits the selected template id, or `null` for a blank ("Vierge") creation. */
  @Output() readonly selectionChange = new EventEmitter<string | null>();

  private readonly templateService = inject(TemplateService);
  private readonly transloco = inject(TranslocoService);
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);

  ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  protected select(templateId: string): void {
    this.selectedId.set(templateId);
    this.selectionChange.emit(templateId);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const templates = this.templates();
    const count = templates.length;
    if (count === 0) return;

    if (event.key === 'Enter' || event.key === ' ') {
      // Explicit handling (rather than relying on native button activation) keeps
      // selection behavior deterministic across browsers and test environments.
      event.preventDefault();
      this.select(templates[index].id);
      return;
    }

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + count) % count;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.focusCardAt(nextIndex);
  }

  protected tabIndexFor(templateId: string): number {
    const selected = this.selectedId();
    const reference = selected ?? this.templates()[0]?.id;
    return reference === templateId ? 0 : -1;
  }

  protected templateName(code: WhiteboardTemplate['code']): string {
    return this.transloco.translate(`whiteboard.template.${this.slugify(code)}.name`);
  }

  protected templateDescription(code: WhiteboardTemplate['code']): string {
    return this.transloco.translate(`whiteboard.template.${this.slugify(code)}.description`);
  }

  protected previewAlt(code: WhiteboardTemplate['code']): string {
    return this.transloco.translate('whiteboard.template.previewAlt', {
      name: this.templateName(code),
    });
  }

  private load(): void {
    this.status.set('loading');
    this.templateService.getTemplates().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.status.set('loaded');
        const defaultTemplate =
          templates.find((t) => t.code === DEFAULT_TEMPLATE_CODE) ?? templates[0] ?? null;
        if (defaultTemplate) {
          this.select(defaultTemplate.id);
        } else {
          this.fallbackToBlank();
        }
      },
      error: () => {
        this.status.set('error');
        this.fallbackToBlank();
      },
    });
  }

  /** No usable template — notify the parent so it falls back to a blank board. */
  private fallbackToBlank(): void {
    this.selectedId.set(null);
    this.selectionChange.emit(null);
  }

  private focusCardAt(index: number): void {
    const cards = this.elementRef.nativeElement.querySelectorAll<HTMLButtonElement>(
      '.template-gallery__card',
    );
    cards[index]?.focus();
  }

  private slugify(code: string): string {
    return code.toLowerCase().replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
  }
}
