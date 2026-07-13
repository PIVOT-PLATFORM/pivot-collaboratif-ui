import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService, TOAST_AUTO_DISMISS_MS } from './toast.service';

describe('ToastService (contrat canonique design-system)', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('show() adds a toast with the given key/type and returns its id', () => {
    const id = service.show('whiteboard.guard.accessDenied', 'error');
    const toasts = service.toasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      id,
      messageKey: 'whiteboard.guard.accessDenied',
      type: 'error',
    });
  });

  it('defaults the type to info', () => {
    service.show('whiteboard.board.delete.success');
    expect(service.toasts()[0].type).toBe('info');
  });

  it('deduplicates an identical key + params, returning the existing id', () => {
    const first = service.show('k', 'info', { n: 1 });
    const second = service.show('k', 'info', { n: 1 });
    expect(second).toBe(first);
    expect(service.toasts()).toHaveLength(1);
  });

  it('does not deduplicate the same key with different params', () => {
    service.show('k', 'info', { n: 1 });
    service.show('k', 'info', { n: 2 });
    expect(service.toasts()).toHaveLength(2);
  });

  it('dismiss() removes the targeted toast only', () => {
    const a = service.show('a');
    const b = service.show('b');
    service.dismiss(a);
    const ids = service.toasts().map((t) => t.id);
    expect(ids).toEqual([b]);
  });

  it('auto-dismisses after TOAST_AUTO_DISMISS_MS', () => {
    vi.useFakeTimers();
    service.show('a');
    expect(service.toasts()).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS);
    expect(service.toasts()).toHaveLength(0);
  });
});
