// src/app/core/services/developer.service.ts
// Five-orites Scoop — the credits page records
//
// WHY A SERVICE WITH A FALLBACK, when the page used to be five literals.
//
// Two reasons, one of which is the whole point of the refactor.
//
// The owner can now edit their own credits from `/admin/developers` without a
// developer, a rebuild and a deploy. That is the feature.
//
// The fallback is what stops that feature from becoming a way to delete the
// credits page. `/developers` is PUBLIC — no route guard, so a signed-out guest
// reaches it and the storefront links it — so a Firestore read that fails, or a
// half-finished seed, would otherwise render a page with no names on it. A public
// page that can go blank is worse than the hardcoded array it replaced. Mirrors
// `ShopSettingsService`'s `DEFAULT_SHOP_SETTINGS`.

import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from '@angular/fire/firestore';

import { AuthService } from './auth.service';
import { DEFAULT_DEVELOPERS, type Developer, type DeveloperDoc } from '../models/developer.model';

@Injectable({ providedIn: 'root' })
export class DeveloperService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  private readonly live = signal<Developer[] | null>(null);

  /**
   * True when the Firestore read failed and the built-in list is standing in.
   *
   * Exposed rather than swallowed: the public page shows a quiet notice when this
   * is true, because "here are the five names" and "here are the five names we
   * happened to ship with" should not look identical.
   */
  readonly usingFallback = signal(false);

  /**
   * The credits, newest position first.
   *
   * `live` is null until the first snapshot resolves, which is why this is a
   * `computed` over a nullable rather than an array — a blank page during load is
   * worse than a brief fallback.
   */
  readonly developers = computed<Developer[]>(() => this.live() ?? [...DEFAULT_DEVELOPERS]);

  /** Subscribe once per consumer that needs live data; the public page does. */
  watch(): () => void {
    const q = query(collection(this.firestore, 'developers'), orderBy('order', 'asc'));
    return onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<DeveloperDoc, 'order'>) }))
          .map((d) => ({ ...d, photoURL: d.photoURL ?? null })) as Developer[];
        // An EMPTY result is a legitimate state only if someone deliberately
        // removed every credit, which the owner-only delete makes unlikely. Treat
        // it as "not loaded" so a transient read of an empty collection cannot
        // blank a public page.
        if (docs.length === 0) {
          this.usingFallback.set(true);
          return;
        }
        this.usingFallback.set(false);
        this.live.set(docs);
      },
      (err) => {
        console.error('Developers read failed; falling back to the built-in list', err);
        this.usingFallback.set(true);
      },
    );
  }

  async create(input: Omit<DeveloperDoc, 'order'> & { order?: number }): Promise<string> {
    const ref = doc(collection(this.firestore, 'developers'));
    const order = input.order ?? (await this.nextOrder());
    await setDoc(ref, {
      name: input.name,
      roles: input.roles,
      accent: input.accent,
      photoURL: input.photoURL ?? null,
      order,
      updatedAt: serverTimestamp(),
      updatedBy: this.auth.currentUserSnapshot?.uid ?? null,
    });
    return ref.id;
  }

  async update(id: string, patch: Partial<Omit<DeveloperDoc, 'order'>>): Promise<void> {
    await setDoc(
      doc(this.firestore, `developers/${id}`),
      {
        ...patch,
        updatedAt: serverTimestamp(),
        updatedBy: this.auth.currentUserSnapshot?.uid ?? null,
      },
      { merge: true },
    );
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, `developers/${id}`));
  }

  async exists(id: string): Promise<boolean> {
    return (await getDoc(doc(this.firestore, `developers/${id}`))).exists();
  }

  /** One past the highest order in use, so a new credit lands at the bottom. */
  private async nextOrder(): Promise<number> {
    const devs = this.developers();
    return devs.reduce((max, d) => Math.max(max, d.order), 0) + 1;
  }
}
