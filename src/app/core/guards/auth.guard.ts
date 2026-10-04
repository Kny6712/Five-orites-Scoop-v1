// src/app/core/guards/auth.guard.ts
// Five-orites Scoop — Authentication Route Guard
// Author: Five-orites Scoop team (see README)

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, map, switchMap, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authReady$.pipe(
    filter((ready) => ready),
    take(1),
    switchMap(() => authService.currentUser$.pipe(take(1))),
    map((user) => {
      if (user) return true;
      router.navigate(['/auth']);
      return false;
    }),
  );
};
