// src/app/core/services/address.service.ts
// Five-orites Scoop — Saved Delivery Address Book (per-user localStorage)

import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';

const GLOBAL_KEY = 'five_orites_addresses_v1';

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
    // storage full / private mode — ignore
  }
}

@Injectable({ providedIn: 'root' })
export class AddressService {
  private authService = inject(AuthService);
  private addressesSubject = new BehaviorSubject<string[]>([]);
  readonly addresses$: Observable<string[]> = this.addressesSubject.asObservable();

  constructor() {
    this.authService.currentUser$.subscribe((user) => {
      this.addressesSubject.next(user ? (readAll()[user.uid] ?? []) : []);
    });
  }

  saveAddress(address: string): void {
    const user = this.authService.currentUserSnapshot;
    const cleaned = address.trim();
    if (!user || !cleaned) return;
    const all = readAll();
    const list = all[user.uid] ?? [];
    if (!list.includes(cleaned)) {
      all[user.uid] = [cleaned, ...list].slice(0, 5); // keep max 5
      writeAll(all);
      this.addressesSubject.next(all[user.uid]);
    }
  }
}
