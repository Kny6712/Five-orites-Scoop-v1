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

  /**
   * Removes one saved address.
   *
   * The mirror of saveAddress(), and deliberately exact-match only: two
   * addresses differing by a trailing space or a full stop are different
   * entries in the stored list, and deleting "the one that looks like the other"
   * would be worse than deleting nothing. Anything the UI presents is already
   * the stored string verbatim, so an exact compare is what the caller means.
   *
   * Removing the last address leaves an empty array rather than deleting the
   * uid key: readAll()[uid] ?? [] reads both the same way, and keeping the key
   * means a sign-out and sign-in round trip cannot resurrect a half-written
   * object.
   */
  removeAddress(address: string): void {
    const user = this.authService.currentUserSnapshot;
    if (!user || !address) return;
    const all = readAll();
    const list = all[user.uid] ?? [];
    if (!list.includes(address)) return;
    all[user.uid] = list.filter((a) => a !== address);
    writeAll(all);
    this.addressesSubject.next(all[user.uid]);
  }
}
