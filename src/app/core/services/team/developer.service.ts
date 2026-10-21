// src/app/core/services/team/developer.service.ts
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
  writeBatch,
} from '@angular/fire/firestore';

import { AuthService } from '@core/services/identity/auth.service';
import {
  DEFAULT_DEVELOPERS,
  type Developer,
  type DeveloperDoc,
} from '@core/models/developer.model';
import { normaliseOrder } from '@core/logic/credits';

@Injectable({ providedIn: 'root' })
export class DeveloperService {
  private firestore = inject(Firestore);
  private auth = inject(AuthService);

  private readonly live = signal<Developer[] | null>(null);

  /**
   * True when the Firestore read failed and the built-in list is standing in.
   *
   * Exposed rather than swallowed: the public page shows a quiet notice when this
   * is true, because "here are the names" and "here are the names we happened to
   * ship with" should not look identical. Counting them out in this comment
   * instead would make it wrong again on the next departure.
   */
  readonly usingFallback = signal(false);

  /**
   * How the credits list resolved, which is NOT the same question as "is it empty".
   *
   * `usingFallback` collapses two genuinely different states into one boolean:
   *
   *   'failed' - the read threw. We do not know what is stored.
   *   'empty'  - the read succeeded and the collection genuinely holds nothing.
   *   'loaded' - the read succeeded and returned documents.
   *
   * They need opposite treatments. On the PUBLIC page both get the fallback,
   * because a guest must never see a blank credits page. On the ADMIN page they
   * must NOT: 'empty' is a real, fixable state that the owner can add their way
   * out of, while 'failed' is an outage where every write will fail.
   *
   * This distinction is the whole reason a page can stop showing four names it is
   * unable to edit. See AdminDevelopersPage.canWrite.
   */
  readonly state = signal<'failed' | 'empty' | 'loaded'>('empty');

  /**
   * The credits, newest position first.
   *
   * `live` is null until the first snapshot resolves, which is why this is a
   * `computed` over a nullable rather than an array — a blank page during load is
   * worse than a brief fallback.
   */
  readonly developers = computed<Developer[]>(() => this.live() ?? [...DEFAULT_DEVELOPERS]);

  /**
   * The real records, or an empty array — never the fallback.
   *
   * For the ADMIN page, and only there. `developers` is right for the public
   * credits page (a guest must never see a blank page) and actively harmful here:
   * on an empty or failed read it hands the owner four names that look editable
   * and are not, and every write against them is a PERMISSION_DENIED against a
   * document id that does not exist.
   *
   * Null collapses to `[]` here on purpose. An admin page showing zero rows and
   * saying so is honest; one showing four rows it cannot touch is a trap.
   */
  readonly liveDevelopers = computed<Developer[]>(() => this.live() ?? []);

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
          // 'empty', NOT 'failed'. This is the case that was previously
          // indistinguishable from an outage, and it is a real fixable state.
          this.state.set('empty');
          this.usingFallback.set(true);
          return;
        }
        this.state.set('loaded');
        this.usingFallback.set(false);
        this.live.set(docs);
      },
      (err) => {
        console.error('Developers read failed; falling back to the built-in list', err);
        this.state.set('failed');
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

  /**
   * Writes a whole new ordering in ONE atomic batch.
   *
   * THE REPLACEMENT FOR THE OLD TWO-WRITE SWAP, and the reason it is a batch
   * rather than two `update()` calls in sequence.
   *
   * Writing the two documents separately means the collection is transiently in
   * an invalid state: both records carry the same `order`, which is a tie under
   * `orderBy('order','asc')` and has no defined position. A snapshot arriving in
   * that window renders the pair in either order, so a click visibly jitters and
   * then corrects itself. Worse, if the second write fails the tie is permanent —
   * and because a swap of two equal values is `x -> x`, that pair can never be
   * moved again. No error, no toast, just a dead button that survives a reload.
   *
   * `writeBatch` commits every write or none of them, so the collection is never
   * observably half-reordered and the failure mode cannot be created.
   *
   * `order` is written alongside `updatedAt`/`updatedBy` because `update()`'s
   * type deliberately excludes it (the service owns ordering) and that type is
   * exactly what made the old call site need a cast. This method owns `order`
   * explicitly instead.
   */
  async writeOrder(orders: ReadonlyMap<string, number>): Promise<void> {
    if (!orders.size) return;
    const batch = writeBatch(this.firestore);
    const stamp = serverTimestamp();
    const by = this.auth.currentUserSnapshot?.uid ?? null;
    for (const [id, order] of orders) {
      batch.set(
        doc(this.firestore, `developers/${id}`),
        { order, updatedAt: stamp, updatedBy: by },
        { merge: true },
      );
    }
    await batch.commit();
  }

  /**
   * One-off repair for records left holding tied or gapped `order` values.
   *
   * Given the ids in the order they should appear, writes contiguous 0..n-1.
   * Nothing else can undo this state: the old swap could not tell a tie from a
   * real move, so it kept writing no-ops forever.
   */
  async normaliseOrder(idsInOrder: readonly string[]): Promise<void> {
    await this.writeOrder(normaliseOrder(idsInOrder));
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
