// src/app/core/services/wishlist.service.ts
// Five-orites Scoop — Wishlist (per-user localStorage, works offline)

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from '@core/services/auth.service';

const GLOBAL_KEY = 'five_orites_wishlist_v1';

function readAll(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(GLOBAL_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, string[]>): void {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private authService = inject(AuthService);
  private wishlistSubject = new BehaviorSubject<string[]>([]);
  readonly wishlist$: Observable<string[]> = this.wishlistSubject.asObservable();

  constructor() {
    this.authService.currentUser$.subscribe((user) => {
      this.wishlistSubject.next(user ? (readAll()[user.uid] ?? []) : []);
    });
  }

  isWished(productId: string): boolean {
    return this.wishlistSubject.getValue().includes(productId);
  }

  toggle(productId: string): boolean {
    const user = this.authService.currentUserSnapshot;
    if (!user) throw new Error('Sign in to use your wishlist.');
    const all = readAll();
    const list = new Set(all[user.uid] ?? []);
    const willAdd = !list.has(productId);
    if (willAdd) list.add(productId);
    else list.delete(productId);
    all[user.uid] = [...list];
    writeAll(all);
    this.wishlistSubject.next(all[user.uid]);
    return willAdd;
  }
}
