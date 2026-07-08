import { Injectable } from '@angular/core';

export type ToastType = 'info' | 'success' | 'error';

/**
 * Stub toast service — console shim until {@link https://github.com/PIVOT-PLATFORM/pivot-design-system}
 * publishes `@pivot/design-system` (EN17.2). Replace with the design-system Toast component then.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  show(message: string, type: ToastType = 'info'): void {
    console.info(`[toast:${type}] ${message}`);
  }
}
