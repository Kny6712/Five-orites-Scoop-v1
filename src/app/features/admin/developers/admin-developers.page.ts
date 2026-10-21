// src/app/features/admin/developers/admin-developers.page.ts
// Five-orites Scoop — managing the public credits page
//
// WHY A SEPARATE ADMIN PAGE rather than editing in place on `/developers`.
//
// `/developers` is public: no route guard, so a signed-out guest reaches it and
// the storefront links it. Putting owner-only controls on it would mean a public
// page whose permission model is a set of `@if`s, which is one route change away
// from showing the wrong thing to the wrong person. Everything editable in this
// app lives under /admin behind a guard, and this keeps that true.
//
// WHO CAN DO WHAT, and why it is not the capability table.
//
//   manager + owner  edit a record, swap a photo
//   owner only        delete someone from the credits
//
// `canManageTeam()` is a rank comparison rather than a ROLE_CAPABILITIES entry
// because tests/logic.test.ts asserts the ladder invariant that a capability
// granted to `manager` must also be granted to `admin`. Using the table would
// force admin into managing who built the app, which is not what was asked for.
// The rules make the same distinction independently in `canManageTeam()`.

import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  AlertController,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';

import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { AdminFooterComponent } from '@shared/components/admin/admin-footer.component';
import { EmptyStateComponent } from '@shared/components/ui/empty-state.component';
import { CloudinaryPipe } from '@shared/pipes/cloudinary.pipe';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { DeveloperService } from '@core/services/team/developer.service';
import { ImageUploadService } from '@core/services/catalog/image-upload.service';
import { AuthService } from '@core/services/identity/auth.service';
import { initialsOf } from '@core/logic/flavour';
import {
  canWriteCredits,
  creditsViewState,
  canDeleteCredit,
  reorderIds,
  type CreditsLoadState,
} from '@core/logic/credits';
import type { Developer } from '@core/models/developer.model';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { DeveloperFormModalComponent } from './developer-form-modal.component';

@Component({
  selector: 'app-admin-developers',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    AppIconComponent,
    AdminFooterComponent,
    EmptyStateComponent,
    CloudinaryPipe,
    AlertBannerComponent,
  ],
  templateUrl: './admin-developers.page.html',
  styleUrls: ['./admin-developers.page.scss'],
})
export class AdminDevelopersPage implements OnInit, OnDestroy {
  private readonly developersService = inject(DeveloperService);
  private readonly imageUpload = inject(ImageUploadService);
  private readonly auth = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);

  /**
   * The real records. NOT `developersService.developers`.
   *
   * See the note on `liveDevelopers`. The fallback list is for the PUBLIC page,
   * where a blank credits page is worse than stale data. Here it is the opposite:
   * four names that look editable and are not, with every write rejected against
   * a document that was never created.
   */
  readonly developers = this.developersService.liveDevelopers;
  readonly usingFallback = this.developersService.usingFallback;
  readonly loadState = this.developersService.state;

  /**
   * The signed-in user's role, as a SIGNAL.
   *
   * `AuthService.currentUserSnapshot` is a plain getter over a BehaviorSubject, so
   * a computed reading it would never re-evaluate and the page would render
   * permanently read-only for anyone whose auth resolved after the first check.
   * See the identical note in OrderNotificationService.
   */
  readonly myRole = signal<string | null>(null);

  /**
   * Owner-only, and only when there is something real to act on.
   *
   * Hidden rather than disabled for anyone below owner: a permanently greyed-out
   * control on a page you can otherwise use is noise, and the rules would refuse
   * it anyway.
   */
  readonly canDelete = computed(() =>
    canDeleteCredit(this.myRole(), this.loadState() as CreditsLoadState),
  );

  /**
   * Whether a write can possibly succeed — the AND of two independent gates.
   *
   * PERMISSION ALONE IS NOT enough, and that was a real bug rather than a
   * hypothetical one. An empty or failed read left the page rendering the
   * fallback list, so Add / Edit / Reorder / Delete all looked live; every one
   * of them wrote to a document id that did not exist, and `firestore.rules`
   * refused each with PERMISSION_DENIED. From the UI that is indistinguishable
   * from a broken button — which is exactly how it was reported.
   *
   * So the controls are gated on whether there is anything real to write TO,
   * not only on who is asking.
   *
   * `canManageCredits()` inside it is NOT `canManageTeam()`, and the difference
   * is also a real bug: `canManageTeam()` is a rank comparison and admin
   * outranks manager, so it returns true for admin, while the rules spell the
   * same intent as `myRole() in ['manager', 'owner']`, which does not. An admin
   * therefore saw four live controls here and was refused on all of them. The
   * rules are the authority — see the note on `canManageCredits`.
   */
  readonly canWrite = computed(() =>
    canWriteCredits(this.myRole(), this.loadState() as CreditsLoadState),
  );

  /**
   * What the screen should present: an outage, an empty collection, or the
   * list.
   *
   * This used to be `this.loadState() === 'failed'` inline — the same decision
   * the framework-free helper already made, re-implemented. `creditsViewState`
   * exists precisely so that this page and the rules cannot disagree about
   * what "failed" means, and a second copy of the decision is a second thing
   * to keep in sync.
   */
  readonly creditsState = computed(() =>
    creditsViewState(this.myRole(), this.loadState() as CreditsLoadState),
  );

  /** True when the read failed, as opposed to genuinely finding nothing. */
  readonly readFailed = computed(() => this.creditsState() === 'error');

  /** True when the credits collection is genuinely empty. */
  readonly isEmpty = computed(() => this.creditsState() === 'empty');

  readonly uploadingFor = signal<string | null>(null);

  /** True while a reorder is in flight. Guards against interleaved clicks. */
  readonly moving = signal(false);

  private unsubscribe?: () => void;

  ngOnInit(): void {
    const sub = this.auth.currentUser$.subscribe((u) => this.myRole.set(u?.role ?? null));
    this.unsubscribe = () => {
      sub.unsubscribe();
      this.devUnsubscribe?.();
    };
    this.devUnsubscribe = this.developersService.watch();
  }

  private devUnsubscribe?: () => void;

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  initialsFor(dev: Developer): string {
    return initialsOf(dev.name);
  }

  /**
   * The tint a role's chip wears, as a class rather than an Ionic colour name.
   *
   * This is DevelopersPage.roleClass(), duplicated deliberately rather than
   * extracted. The one thing this page is FOR is previewing what the public
   * credits page will render, so an admin editing a record has to see the same
   * chip colour they will get there - and if the two lists ever diverge, the
   * preview is lying about the thing it exists to preview.
   *
   * An unrecognised role degrades to `role-plain` in both rather than inventing
   * a hue of its own, which would put an unchecked colour pair into the page
   * every time somebody adds a role.
   */
  roleClass(role: string): string {
    if (role.includes('Lead')) return 'role-lead';
    if (role.includes('Full Stack')) return 'role-dev';
    if (role.includes('UI/UX')) return 'role-design';
    if (role === 'QA') return 'role-qa';
    return 'role-plain';
  }

  // ── Add / edit ─────────────────────────────────────────────────────────

  /**
   * Opens the add form.
   *
   * A modal rather than the inline panel this replaced - see the note at the top
   * of developer-form-modal.component.ts for why the vouchers page's "keep the
   * list visible while you type" reasoning does not transfer to this page.
   *
   * The outcome is read back rather than assumed, because the modal decides what
   * it saved: it dismisses with `{ saved: true }` only after the Firestore write
   * resolves, so a failure leaves the modal open showing its error and this
   * presenter never reaches the toast.
   */
  async startCreate(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeveloperFormModalComponent,
      componentProps: { developer: 'new' as const },
      cssClass: 'large-sheet-modal',
    });
    // THIS LINE WAS MISSING, and nothing happened when the button was pressed.
    //
    // `ModalController.create()` only BUILDS the overlay - it constructs the
    // component and hands back a handle. It does not put it on screen. Without
    // `present()` the modal is created, never shown, and the very next line
    // (`onDidDismiss()`) then waits forever on an overlay that was never
    // presented. So the handler ran, built a modal, and returned.
    //
    // `inventory.page.ts` `openImport()` is the reference: create, present, then
    // read the dismiss result. Same order here.
    await modal.present();
    const result = await modal.onDidDismiss();
    if (result?.data?.saved) await this.toast('Developer added.', 'success');
  }

  /** Opens the same modal, seeded with an existing record. */
  async startEdit(dev: Developer): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DeveloperFormModalComponent,
      componentProps: { developer: dev },
      cssClass: 'large-sheet-modal',
    });
    // Present, or see the note on startCreate() above - this handler had the
    // identical omission, so Edit was as dead as Add.
    await modal.present();
    const result = await modal.onDidDismiss();
    if (result?.data?.saved) await this.toast('Developer updated.', 'success');
  }

  // ── Photo ───────────────────────────────────────────────────────────────

  /**
   * Uploads a photo through the existing Cloudinary path.
   *
   * `uploadAvatar` rather than `uploadProductImage` — square centre-crop at 512px,
   * which is what an avatar wants, against a product image's aspect ratio.
   *
   * Written immediately rather than staged in the modal: this button sits on the
   * row itself, and there is no form open behind it to hold a value in. That is
   * why the modal carries its own picker - this is the one-tap path for the
   * common case of fixing a photo, and the modal's is the one that lets a photo
   * be chosen as part of creating a record.
   *
   * The asset is not destroyed if this fails or the photo is later removed - see
   * the note in ImageUploadService - it just stops being referenced.
   */
  async onPhotoSelected(event: Event, dev: Developer): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately, or picking the same file twice fires no change event.
    input.value = '';
    if (!file) return;

    this.uploadingFor.set(dev.id);
    try {
      const url = await this.imageUpload.uploadAvatar(file);
      await this.developersService.update(dev.id, { photoURL: url });
      await this.toast('Photo updated.', 'success');
    } catch (err: unknown) {
      await this.toast(
        err instanceof Error ? err.message : 'Could not upload that photo.',
        'danger',
      );
    } finally {
      this.uploadingFor.set(null);
    }
  }

  async clearPhoto(dev: Developer): Promise<void> {
    try {
      await this.developersService.update(dev.id, { photoURL: null });
      await this.toast('Photo removed.', 'success');
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('that photo', err), 'danger');
    }
  }

  // ── Order ───────────────────────────────────────────────────────────────

  /**
   * Swaps two adjacent credits by swapping their `order` values.
   *
   * Two writes rather than renumbering the whole list: at five records a full
   * renumber is four writes for the same result, and the swap is the operation
   * that actually happened.
   */
  async move(index: number, delta: -1 | 1): Promise<void> {
    // Double-tap guard. Without it two clicks read the SAME stale list and
    // interleave, so the second commit silently undoes the first and the row
    // appears not to move at all. One write in flight at a time.
    if (this.moving()) return;
    const ids = this.developers().map((d) => d.id);
    const orders = reorderIds(ids, index, delta);
    if (!orders.size) return;

    this.moving.set(true);
    try {
      await this.developersService.writeOrder(orders);
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('the developer order', err), 'danger');
    } finally {
      this.moving.set(false);
    }
  }

  /**
   * Repairs records left holding tied or gapped `order` values.
   *
   * The old swap wrote the two `order` fields in two separate calls, so the
   * collection could be observed with both records carrying the same value — and
   * a swap of two equal values is `x -> x`. That pair was then permanently
   * un-movable: no error, no toast, and it survives a reload. This is the only
   * thing that can undo it, so the page offers it explicitly rather than
   * hoping the ties sort themselves out.
   *
   * Offered only when there is genuinely something to repair, so a healthy list
   * never shows a pointless control.
   */
  readonly orderIsTied = computed(() => {
    const orders = this.developers().map((d) => d.order);
    return new Set(orders).size !== orders.length;
  });

  async repairOrder(): Promise<void> {
    if (this.moving()) return;
    this.moving.set(true);
    try {
      await this.developersService.normaliseOrder(this.developers().map((d) => d.id));
      await this.toast('Order repaired.', 'success');
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('the developer order', err), 'danger');
    } finally {
      this.moving.set(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  /**
   * Removes a credit, behind a confirm.
   *
   * Owner only, and the button is hidden rather than disabled for anyone else:
   * a control that is permanently greyed out on a page you can otherwise use is
   * noise, and there is nothing to discover by pressing it.
   */
  async confirmRemove(dev: Developer): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Remove ${dev.name}?`,
      cssClass: 'alert-danger',
      message:
        'This removes them from the credits page. The photo already uploaded to ' +
        'Cloudinary is not deleted with it, so it stays in the media library until ' +
        'it is cleaned up there.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            try {
              await this.developersService.remove(dev.id);
              await this.toast('Developer removed.', 'success');
            } catch (err: unknown) {
              await this.toast(describeFirestoreError('that developer', err), 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string, color: 'danger' | 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, color, duration: 2200, position: 'top' });
    await t.present();
  }
}
