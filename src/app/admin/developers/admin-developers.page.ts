// src/app/admin/developers/admin-developers.page.ts
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
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonMenuButton,
  IonList,
  IonItem,
  IonInput,
  IonTextarea,
  IonSpinner,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';

import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { DeveloperService } from '../../core/services/developer.service';
import { ImageUploadService } from '../../core/services/image-upload.service';
import { AuthService } from '../../core/services/auth.service';
import { initialsOf } from '../../core/logic/flavor';
import { canManageTeam } from '../../core/models/user.model';
import {
  DEVELOPER_ACCENTS,
  type Developer,
  type DeveloperDoc,
} from '../../core/models/developer.model';
import { describeFirestoreError } from '../../core/logic/firestore-error';

/** Roles offered as one-tap suggestions. Free text is still accepted. */
const ROLE_SUGGESTIONS: readonly string[] = [
  'Main Project Lead',
  'Full Stack Dev',
  'UI/UX Designer Lead',
  'UI/UX Designer',
  'QA',
  'Documentation',
];

@Component({
  selector: 'app-admin-developers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonButton,
    IonMenuButton,
    IonList,
    IonItem,
    IonInput,
    IonTextarea,
    IonSpinner,
    AppIconComponent,
    AppFooterComponent,
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

  readonly developers = this.developersService.developers;
  readonly usingFallback = this.developersService.usingFallback;
  readonly accents = DEVELOPER_ACCENTS;
  readonly roleSuggestions = ROLE_SUGGESTIONS;

  /**
   * The signed-in user's role, as a SIGNAL.
   *
   * `AuthService.currentUserSnapshot` is a plain getter over a BehaviorSubject, so
   * a computed reading it would never re-evaluate and the page would render
   * permanently read-only for anyone whose auth resolved after the first check.
   * See the identical note in OrderNotificationService.
   */
  readonly myRole = signal<string | null>(null);

  readonly canEdit = computed(() => canManageTeam(this.myRole()));
  readonly canDelete = computed(() => this.myRole() === 'owner');

  /** The record being edited, or null. Drives the form panel. */
  readonly editing = signal<Developer | 'new' | null>(null);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly uploadingFor = signal<string | null>(null);

  formName = '';
  formRoles: string[] = [];
  formRoleDraft = '';
  formAccent = DEVELOPER_ACCENTS[0].hex;
  formPhotoURL: string | null = null;

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

  // ── Form ────────────────────────────────────────────────────────────────

  startEdit(dev: Developer): void {
    this.errorMessage.set('');
    this.editing.set(dev);
    this.formName = dev.name;
    this.formRoles = [...dev.roles];
    this.formRoleDraft = '';
    this.formAccent = dev.accent;
    this.formPhotoURL = dev.photoURL;
  }

  startCreate(): void {
    this.errorMessage.set('');
    this.editing.set('new');
    this.formName = '';
    this.formRoles = [];
    this.formRoleDraft = '';
    this.formAccent = DEVELOPER_ACCENTS[0].hex;
    this.formPhotoURL = null;
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.errorMessage.set('');
  }

  addRole(role: string): void {
    const trimmed = role.trim();
    // Case-insensitive, so "qa" and "QA" cannot both end up on one card.
    if (!trimmed || this.formRoles.some((r) => r.toLowerCase() === trimmed.toLowerCase())) return;
    this.formRoles = [...this.formRoles, trimmed];
    this.formRoleDraft = '';
  }

  removeRole(role: string): void {
    this.formRoles = this.formRoles.filter((r) => r !== role);
  }

  /**
   * Saves the form.
   *
   * Client-side validation mirrors `developerIsWellFormed()` in firestore.rules
   * deliberately. The rules are the real gate — a rule the UI duplicates is a
   * second thing to keep in step — but failing here turns a PERMISSION_DENIED into
   * a readable message instead of a generic one.
   */
  async save(): Promise<void> {
    if (this.saving()) return;
    const name = this.formName.trim();
    if (!name) {
      this.errorMessage.set('Enter a name.');
      return;
    }
    if (name.length > 80) {
      this.errorMessage.set('That name is longer than 80 characters.');
      return;
    }
    if (this.formRoles.length > 12) {
      this.errorMessage.set('Twelve roles is the limit.');
      return;
    }
    if (!this.formRoles.length) {
      this.errorMessage.set('Add at least one role.');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    const payload: Omit<DeveloperDoc, 'order'> = {
      name,
      roles: this.formRoles,
      accent: this.formAccent,
      photoURL: this.formPhotoURL,
    };

    try {
      const target = this.editing();
      if (target === 'new') {
        await this.developersService.create(payload);
      } else if (target) {
        await this.developersService.update(target.id, payload);
      }
      this.editing.set(null);
      await this.toast(target === 'new' ? 'Developer added.' : 'Developer updated.', 'success');
    } catch (err: unknown) {
      this.errorMessage.set(describeFirestoreError('the developer list', err));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Photo ───────────────────────────────────────────────────────────────

  /**
   * Uploads a photo through the existing Cloudinary path.
   *
   * `uploadAvatar` rather than `uploadProductImage` — square centre-crop at 512px,
   * which is what an avatar wants, against a product image's aspect ratio.
   *
   * The returned URL is written to the record only when the form is saved, so
   * picking a photo and then cancelling does not leave an orphaned asset behind
   * pointing at nothing. The asset is not destroyed on cancel — see the note in
   * ImageUploadService — but nothing references it.
   */
  async onPhotoSelected(event: Event, dev: Developer | 'new'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const key = dev === 'new' ? 'new' : dev.id;
    this.uploadingFor.set(key);
    try {
      const url = await this.imageUpload.uploadAvatar(file);
      if (dev === 'new') {
        this.formPhotoURL = url;
      } else {
        // Saved immediately rather than held: a photo swap on an existing card has
        // no form open to stage it in.
        await this.developersService.update(dev.id, { photoURL: url });
        await this.toast('Photo updated.', 'success');
      }
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
    const list = this.developers();
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    try {
      await this.developersService.update(a.id, { order: b.order } as Partial<DeveloperDoc>);
      await this.developersService.update(b.id, { order: a.order } as Partial<DeveloperDoc>);
    } catch (err: unknown) {
      await this.toast(describeFirestoreError('the developer order', err), 'danger');
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
