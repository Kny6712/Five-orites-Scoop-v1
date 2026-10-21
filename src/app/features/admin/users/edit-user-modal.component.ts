// src/app/features/admin/users/edit-user-modal.component.ts
// Five-orites Scoop — Edit one user account, in a modal overlay.
//
// Replaced the inline `<section class="editor">` panel that sat inside
// ion-content and pushed the user list down whenever it opened. A modal does not
// disturb the list, which is what this page actually needs — an admin editing
// one row does not need the whole directory visible while they type.
//
// Follows the house modal pattern used by developer-form-modal.component.ts:
// an `@Input()` setter seeds the form (componentProps land after construction),
// save() dismisses `{ saved: true }` only after a successful Firestore write,
// errors are shown inline via the `error()` signal, and cancel() dismisses with
// no data so the presenter does nothing.

import { Component, inject, Input, signal, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonTextarea,
  ModalController,
} from '@ionic/angular/standalone';

import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { AppUser, UserRole, ROLE_LABELS, asRole } from '@core/models/user.model';
import { AuthService } from '@core/services/identity/auth.service';

@Component({
  selector: 'app-edit-user-modal',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonTextarea,
    AppIconComponent,
  ],
  templateUrl: './edit-user-modal.component.html',
  styleUrls: ['./edit-user-modal.component.scss'],
})
export class EditUserModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);

  @Input()
  set user(value: AppUser) {
    this._user = value;
    this.seedFromUser();
  }
  get user(): AppUser {
    return this._user;
  }
  private _user!: AppUser;

  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected editName = '';
  protected editPhone = '';
  protected editRole: UserRole = 'customer';
  protected editNote = '';
  protected isSuspended = false;
  protected suspendReason = '';

  private readonly myUid = this.auth.currentUserSnapshot?.uid ?? null;
  private readonly myRole = asRole(this.auth.currentUserSnapshot?.role);

  readonly roleOptions = ((): { value: UserRole; label: string }[] => {
    const all: { value: UserRole; label: string }[] = (
      ['customer', 'staff', 'manager', 'admin', 'owner'] as UserRole[]
    ).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
    return this.myRole === 'owner' ? all : all.filter((r) => r.value !== 'owner');
  })();

  protected get canChangeEditRole(): boolean {
    return this.myRole === 'owner' && this.user.uid !== this.myUid;
  }

  protected get isSelf(): boolean {
    return this.user.uid === this.myUid;
  }

  private seedFromUser(): void {
    const u = this.user;
    this.editName = u.displayName ?? '';
    this.editPhone = u.phone ?? '';
    this.editRole = asRole(u.role);
    this.editNote = u.adminNote ?? '';
    this.isSuspended = u.isSuspended === true;
    this.suspendReason = u.suspendReason ?? '';
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const name = this.editName.trim();
    if (!name) {
      this.error.set('Enter a display name.');
      return;
    }
    if (this.isSelf && this.editRole !== this.myRole) {
      this.error.set(
        'You cannot change your own role — that would lock you out of the admin pages you can reach.',
      );
      return;
    }
    if (!this.isSelf && !this.canChangeEditRole) {
      this.error.set('Only an Owner can change a role.');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    try {
      await setDoc(
        doc(this.firestore, `users/${this.user.uid}`),
        {
          displayName: name,
          phone: this.editPhone.trim() || null,
          role: this.editRole,
          adminNote: this.editNote.trim() || null,
          isSuspended: this.isSuspended,
          ...(this.isSuspended
            ? {
                suspendReason: this.suspendReason.trim() || 'No reason given',
                suspendedAt: Date.now(),
              }
            : { suspendReason: null, suspendedAt: null }),
        },
        { merge: true },
      );
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err: unknown) {
      this.error.set(describeFirestoreError('that user', err));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss();
  }
}
