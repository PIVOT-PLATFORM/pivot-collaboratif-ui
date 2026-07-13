import { Injectable, signal } from '@angular/core';

/**
 * Types visuels de toast — contrat canonique du design system PIVOT
 * (`@pivot-platform/design-system`).
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/** Lien d'action optionnel affiché dans un toast (clé Transloco, jamais de libellé en dur). */
export interface ToastAction {
  /** Clé de traduction Transloco du libellé du lien. */
  labelKey: string;
  /** Cible de routing Angular. */
  route: string;
}

/** Un toast affiché par le conteneur global (clé Transloco, jamais de libellé en dur). */
export interface Toast {
  /** Identifiant unique (généré par le service). */
  id: number;
  /** Clé de traduction Transloco du message — traduite au rendu. */
  messageKey: string;
  /** Type visuel — pilote le modificateur BEM et la live region ARIA. */
  type: ToastType;
  /** Paramètres d'interpolation Transloco optionnels. */
  params?: Record<string, string | number>;
  /** Lien d'action optionnel. */
  action?: ToastAction;
}

/** Durée d'affichage avant fermeture automatique (ms). */
export const TOAST_AUTO_DISMISS_MS = 8000;

/**
 * Service global de notifications toast.
 *
 * **Aligné sur le contrat canonique de `@pivot-platform/design-system`** (réconciliation
 * du `ToastService`, EN17.13) : mêmes signatures, types et interfaces que le DS, de sorte
 * que le passage au package publié (EN17.2/EN17.3) se réduira à
 * `export { ToastService } from '@pivot-platform/design-system'` et à la suppression de ce
 * fichier — sans toucher aux appelants.
 *
 * Le message est une **clé Transloco** (traduite au rendu par le conteneur toast global du
 * shell), jamais un libellé en dur. Chaque toast est auto-fermé après
 * {@link TOAST_AUTO_DISMISS_MS} et peut être fermé via {@link dismiss}.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  private nextId = 0;

  /** Liste réactive des toasts actuellement affichés. */
  readonly toasts = this._toasts.asReadonly();

  /**
   * Affiche un toast. Dédupliqué si une clé + params identiques est déjà affichée.
   *
   * @param messageKey clé Transloco du message
   * @param type       type visuel (défaut `info`)
   * @param params     paramètres d'interpolation Transloco optionnels
   * @param action     lien d'action optionnel (clé Transloco + route)
   * @returns l'identifiant du toast affiché (existant si dédupliqué)
   */
  show(
    messageKey: string,
    type: ToastType = 'info',
    params?: Record<string, string | number>,
    action?: ToastAction,
  ): number {
    const existing = this._toasts().find(
      (t) => t.messageKey === messageKey && JSON.stringify(t.params) === JSON.stringify(params),
    );
    if (existing) {
      return existing.id;
    }
    const id = ++this.nextId;
    this._toasts.update((list) => [...list, { id, messageKey, type, params, action }]);
    setTimeout(() => this.dismiss(id), TOAST_AUTO_DISMISS_MS);
    return id;
  }

  /**
   * Ferme un toast (manuellement ou via l'auto-dismiss).
   *
   * @param id identifiant retourné par {@link show}
   */
  dismiss(id: number): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
