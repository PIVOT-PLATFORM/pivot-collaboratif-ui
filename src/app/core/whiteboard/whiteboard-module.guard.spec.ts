import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { whiteboardModuleGuard } from './whiteboard-module.guard';

describe('whiteboardModuleGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should always grant access (stub — returns true until @pivot-platform/ui-core is published)', async () => {
    const result = TestBed.runInInjectionContext(() =>
      whiteboardModuleGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    const value = isObservable(result)
      ? await firstValueFrom(result)
      : await Promise.resolve(result);

    expect(value).toBe(true);
  });
});
