// src/app/features/admin/developers/developer-form-modal.component.ts
// Five-orites Scoop — add or edit one credit, in a modal
//
// WHY A MODAL RATHER THAN THE INLINE PANEL THIS REPLACED.
//
// The form used to be a card that opened above the list, which is the treatment
// the vouchers page uses. That choice is written down there as deliberate — "it
// means the list stays visible while you type a code against it, so a duplicate
// is spotted by looking rather than by being told."
//
// That reasoning does not transfer. A voucher CODE is the identity of the
// record, and two of them colliding is the failure worth catching by eye. A
// developer's identity is their NAME, which is free text and cannot collide in
// any way the eye could judge — and the list this modal covers is at most a
// handful of rows, so "the list stays visible" is worth very little here. What
// the page actually needs is a form that does not shove the rows it is editing
// around the moment it opens, which is what the panel did.
//
// So this follows the OTHER house pattern instead — the one the inventory page
// uses for add/edit product — and the panel is gone.
//
// ONE COMPONENT FOR BOTH ROLES, not an add-modal and an edit-modal. The field
// set is identical either way; the only difference is whether `developer` is a
// record or the string 'new', and whether Save calls create() or update(). The
// inventory page needs two components because the two forms are genuinely
// different (four price inputs and a stock preview versus neither); this one
// does not.
//
// THE PHOTO IS STAGED, NOT WRITTEN ON PICK.
//
// `uploadAvatar` runs the moment a file is chosen, but the resulting URL is only
// held in `photoURL` until Save. That is the same rule the old panel followed and
// the reason is worth keeping: cancelling must not leave an uploaded asset
// sitting in the Cloudinary library that nothing references. (It does not
// delete the asset on cancel — nothing does — it just does not write a URL that
// points at an orphan.)

import { Component, inject, Input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonInput, IonSpinner, IonTextarea, ModalController } from '@ionic/angular/standalone';

import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { DeveloperService } from '@core/services/team/developer.service';
import { ImageUploadService } from '@core/services/catalog/image-upload.service';
import { describeFirestoreError } from '@core/logic/firestore-error';
import { DEVELOPER_ACCENTS, type Developer, type DeveloperDoc } from '@core/models/developer.model';

@Component({
  selector: 'app-developer-form-modal',
  standalone: true,
  imports: [FormsModule, IonInput, IonSpinner, IonTextarea, AppIconComponent],
  template: `
    <div class="sheet">
      <header class="sheet-head">
        <h2 class="sheet-title">{{ isNew ? 'Add Developer' : 'Edit developer' }}</h2>
        <p class="sheet-sub">
          {{
            isNew
              ? 'They will appear on the public Team Credits page.'
              : 'Changes go live on the public Team Credits page.'
          }}
        </p>
      </header>

      <h3 class="section-title">Developer Details</h3>

      <div class="stack">
        <!-- Name + Photo side by side -->
        <div class="details-row">
          <!-- Photo column -->
          <div class="photo-col">
            <span class="field-label">Photo</span>
            <div
              class="photo-disc"
              [class.photo-disc--empty]="!photoURL"
              [style.background]="photoURL ? accent : null"
            >
              @if (photoURL) {
                <img [src]="photoURL" alt="" />
              } @else {
                <app-icon name="user-round" class="photo-placeholder" />
              }
              @if (uploading()) {
                <span class="photo-veil"><ion-spinner name="crescent"></ion-spinner></span>
              }
            </div>
            <div class="photo-actions">
              <label class="photo-btn">
                <app-icon name="camera" />
                <span>Upload Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  [disabled]="uploading()"
                  (change)="onPhotoSelected($event)"
                />
              </label>
            </div>
            <p class="field-hint">Optional. Recommended: Square, min. 400px.</p>
          </div>

          <!-- Name column -->
          <div class="name-col">
            <span class="field-label">Name</span>
            <ion-input
              [(ngModel)]="name"
              maxlength="80"
              placeholder="full name"
              aria-label="Full name"
              class="modal-input"
            ></ion-input>
          </div>
        </div>

        <!-- Roles -->
        <div class="field field--chips">
          <span class="field-label">ROLE</span>
          <p class="role-hint">Add at least one role.</p>
          <div class="role-chips">
            @for (role of roles; track role) {
              <span class="role-chip">
                {{ role }}
                <button
                  type="button"
                  class="role-remove hit-44"
                  (click)="removeRole(role); $event.stopPropagation()"
                  [attr.aria-label]="'Remove ' + role"
                >
                  ×
                </button>
              </span>
            }
            @if (!roles.length) {
              <span class="role-empty">No roles yet.</span>
            }
          </div>

          <!--
            THE FIELD AND ITS BUTTON ARE ONE BOX.

            The + used to sit OUTSIDE the field, floating in the gap to the
            right of it, so it read as a separate control that happened to be
            near the text rather than as part of the text field. It is inside
            now, in the field's own top-right corner, and the border is the
            field's.

            THE TOP-RIGHT CORNER, and not the bottom-right, because the
            browser's own resize grip lives there: Chrome draws it in the
            bottom-right corner of the text area, and a grip you cannot reach
            is a broken control. Two controls in one corner means one of them
            loses.
          -->
          <div class="role-field">
            <!--
              Free text, not a dropdown.

              A dropdown of six canned titles was tried here and it was wrong
              for this field: these are CREDITS, not permissions. "Main
              Project Lead" and "Documentation" are not a vocabulary anybody
              else needs to agree on, so a closed list would have quietly
              refused a role the team actually wanted to write. The model
              says the same thing (core/models/developer.model.ts): roles are
              free text, and the public page styles each chip by substring
              so an unusual title still gets a sensible colour.

              So the field is a text box, and the curated titles are not
              imposed on the owner.
            -->
            <ion-textarea
              [(ngModel)]="roleDraft"
              placeholder="Add another role"
              (keydown.enter)="addRole(roleDraft); $event.stopPropagation()"
              rows="4"
              aria-label="Add a role"
              class="role-textarea"
            ></ion-textarea>
            <button
              type="button"
              class="role-add-btn"
              (click)="addRole(roleDraft)"
              aria-label="Add this role"
            >
              <app-icon name="plus" />
            </button>
          </div>

          <p class="field-hint role-optional-hint">Optional. You can add multiple roles.</p>
        </div>
      </div>

      @if (error()) {
        <p class="sheet-error" role="alert">{{ error() }}</p>
      }

      <div class="actions">
        <!--
          TWO PLAIN <button>s, and the reason is the same one the reviews
          page's reply box has: an "ion-button" paints its fill on an inner
          shadow-root element, so its Material elevation shadow and its
          uppercase md scale are both out of reach of a stylesheet outside the
          component. The result here was a "SAVE DEVELOPER" carrying three
          layers of shadow in periwinkle — the toolbar's own colour, which is
          the defect the developers page's own toolbar comment describes.

          Save is the app's amber CTA — --color-brand-accent fill,
          --color-ink ink, --radius-sm, no border, no shadow — and Cancel is
          the quiet one beside it.
        -->
        <button type="button" class="btn-quiet" (click)="cancel()">Cancel</button>
        <button
          type="button"
          class="btn-primary"
          (click)="save()"
          [disabled]="saving() || uploading()"
        >
          @if (saving()) {
            <ion-spinner name="crescent"></ion-spinner>
          }
          Save developer
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .sheet {
        padding: var(--space-5) var(--space-4) var(--space-4);
      }

      .sheet-head {
        margin-bottom: var(--space-5);
      }
      .sheet-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 20px;
        font-weight: 600;
        color: var(--color-ink);
      }
      .sheet-sub {
        margin: 3px 0 0;
        font-size: 13px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }

      .section-title {
        margin: 0 0 var(--space-4) 0;
        font-family: var(--font-display);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-ink);
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-6);
      }

      /* Name (right) beside Photo (left) */
      .details-row {
        display: flex;
        flex-direction: row;
        gap: var(--space-6);
        align-items: flex-start;
      }
      .photo-col {
        flex: 0 0 auto;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
      }
      .name-col {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      /* A PHONE.

         The photo column and the name field sit side by side on a desktop,
         which on a 390px screen leaves the name field about 120px wide — too
         narrow to type a name into, and the placeholder clipped to "full".
         Below 560px the row stacks and the field gets the whole sheet. */
      @media (max-width: 560px) {
        .details-row {
          flex-direction: column;
          align-items: stretch;
          gap: var(--space-4);
        }
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .field-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-ink);
      }
      .field-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }

      /* ── Roles field variants ────────────────────────────────────────
         .field--row   : header row — "Roles" label left, single red Remove
                          button right (clears every role at once).
         .field--chips : below it — just the pastel role chips, no buttons. */
      .field--row {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .field--chips {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }
      .role-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        min-height: 26px;
      }
      .role-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 6px 4px 11px;
        border-radius: var(--radius-pill);
        background: var(--tile-powder);
        color: var(--color-ink);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .role-clear {
        border: 0;
        background: transparent;
        padding: 4px 10px;
        margin: 0;
        cursor: pointer;
        color: var(--color-danger);
        font-size: 11px;
        font-weight: 700;
        border-radius: var(--radius-pill);
        white-space: nowrap;
        border: 1px solid var(--color-danger);
      }
      .role-clear:hover {
        background: var(--color-danger);
        color: var(--color-white);
      }

      /* Per-role removal x buttons, shown only while Remove/Cancel is active. */
      .role-chip {
        position: relative;
        padding-right: 22px; /* make room for the x button inside the chip */
      }
      .role-remove {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        width: 16px;
        height: 16px;
        border: 0;
        background: transparent;
        border-radius: 0;
        color: var(--color-danger);
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        padding: 0;
        display: grid;
        place-items: center;
      }
      .role-remove:hover {
        color: var(--color-danger);
        opacity: 0.8;
      }

      /* ON A PHONE, THE CHIP IS 44px TALL.

         The × is absolutely positioned inside the chip, so a 44px target
         around a 24px pill overflowed the pill — 10px above and below it —
         and, because a minimum beats a width, it also grew 28px wider than
         the 22px the chip had reserved for it. It covered the chip's own text.

         The chip grows to hold the target instead, so the overlay fits inside
         it and touches nothing. The × keeps its own 16px box (the hit-44
         class) and gets its 44px from a transparent overlay — see the note on
         that class in global.scss. */
      @media (max-width: 768px) {
        .role-chip {
          min-height: 44px;
          padding: 4px 26px 4px 14px;
        }
        .role-remove {
          width: 20px;
          height: 20px;
          right: 3px;
        }

        /* ONE ROW, NOT FOUR.

           The field is for ONE role title — the model's own comment says the
           titles are free text — and it was four rows tall on a phone, which
           is a large empty box for a single line.

           The height is NOT set here, and that is deliberate: Ionic sizes the
           NATIVE textarea from its rows attribute, and the native textarea
           is Ionic's element, not Angular's, so it carries no scoping
           attribute and a rule in this component's stylesheet cannot match
           it. The height is dealt with in global.scss, which is not scoped. */
      }
      .role-empty {
        font-size: 12px;
        color: var(--ion-color-medium);
      }

      .role-hint {
        margin: 0 0 var(--space-2) 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--color-ink);
      }

      /* ── The role field and its button ──────────────────────────────────

         THE FIELD IS RESIZABLE, and it is resizable because NOTHING DECLARES
         A HEIGHT for it.

         The old rule set "min-height: 120px" on the host, which pinned the box
         at 120px no matter what the browser's resize grip did. The grip moves
         the TEXT AREA; the frame around it stayed exactly where it was, so
         dragging the grip up looked like it did nothing at all — the box was
         the same height before and after, which is the definition of a broken
         control.

         The native textarea's height is "auto", so the host is exactly as tall
         as the text area, and the grip moves both. The floor is the platform's
         own 44px for a text field, which is one line of text plus its padding.

         "resize: vertical" itself is global — see the ion-textarea rules in
         src/global.scss, which reach the inner <textarea> because Ionic's
         scoped light DOM gives it no _ngcontent attribute of its own.
      */
      .role-field {
        position: relative;
        margin-top: var(--space-2);
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-xs);
        background: var(--color-white);
      }
      .role-field:focus-within {
        border-color: var(--color-primary-ink);
      }
      .role-textarea {
        --border-radius: var(--radius-xs);
        --background: var(--color-white);
        --box-shadow: none;
        display: block;
        width: 100%;
        font: inherit;
        font-size: 15px;
        color: var(--color-ink);
      }

      /* The + button, INSIDE the field's top-right corner.

         The app's quiet control — white, one hairline, no shadow — at the
         size that fits a field corner. The plus is Lucide's, because the
         app's icons are Lucide's and a hand-typed "+" was the only glyph in
         the sheet that was not. */
      .role-add-btn {
        position: absolute;
        top: 8px;
        right: 8px;

        /* ABOVE THE TEXT AREA, and not beside it.

           Ionic gives ion-textarea "z-index: 2" on its host, so a positioned
           button with the default z-index of 0 lands UNDERNEATH it — the
           textarea's white field paints over the button and the button is
           simply not there. 3 puts it back on top. */
        z-index: 3;

        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-xs);
        background: var(--color-white);
        color: var(--color-primary-ink);
        cursor: pointer;
      }
      .role-add-btn:hover {
        background: var(--tile-powder);
        border-color: var(--color-primary-ink);
      }
      .role-add-btn app-icon {
        --icon-size: 16px;
      }
      .name-col ion-input {
        --border-color: transparent;
        --border-focus-color: transparent;
      }
      .modal-input {
        width: 100%;
        min-height: 44px;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-xs);
        background: var(--color-white);
        color: var(--color-ink);
        font: inherit;
        font-size: 15px;
      }
      /* Ionic 7 exposes NO shadow part on ion-input (its <input> carries no
         part attribute), so ::part(input) here matched nothing and every
         padding written through it was silently dropped. The text inset is
         driven by --padding-start / --padding-end in global.scss, which is
         the only mechanism that reaches the native control. */
      .role-optional-hint {
        margin: var(--space-2) 0 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--ion-color-medium);
      }

      /* ── Photo ─────────────────────────────────────────────────────────
         72px rather than the list row's 56px: this is the largest rendering of
         the disc anywhere in the admin, and it is the one being chosen in. */
      .photo-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
      }
      .photo-disc {
        position: relative;
        width: 72px;
        height: 72px;

        /* A CIRCLE, like every other avatar of a person in this app: the
           developer list's .dev-avatar and the public credits page's disc are
           both 50%. This one was the last rounded square — the one place a
           person's picture was shown in a shape nothing else in the app uses. */
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
      }
      .photo-disc img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      /* THE EMPTY PHOTO: a charcoal disc with a white person in it.

         The accent pastel stays bound to the disc for the case that matters —
         the photo is on top of it, and if the image ever fails to load the
         disc behind it is that developer's own colour rather than a hole.

         When there is NO photo the disc is the dark placeholder instead, and
         that is the point: the pastel disc is a developer's own colour (it is
         what their initials are drawn on in the public credits page), so
         painting an absent photo in it would be inventing a colour for
         somebody who has no picture and no initials yet. A neutral dark disc
         says "nothing here" instead.

         The glyph is Lucide's "user-round" — a round head on round shoulders.
         The one that was here before, "user", is a circle head on a SQUARE
         body, which is a pictogram of a robot rather than a person. It is
         drawn as line art in white, not filled: on a dark disc the outline is
         what reads, and a filled bust at this size closes up into a blob.

         2.5 is the stroke weight, not Lucide's 2. At 30px the icon is a
         quarter larger than Lucide draws it, and the default stroke would
         come out a shade lighter than the rest of the app's line art. */
      .photo-disc--empty {
        background: var(--color-photo-placeholder);
      }
      .photo-placeholder {
        --icon-size: 30px;
        --icon-stroke: 2.5;
        color: var(--color-white);
      }
      .photo-veil {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: rgb(36 24 51 / 0.45);
      }
      .photo-actions {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
      }
      /* A real <label> wrapping a real file input, so it is focusable and
         keyboard-operable — the pattern the profile page and the inventory
         replace-photo sheet both use. */
      .photo-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--color-primary-ink);
        background: transparent;
        border-radius: var(--radius-pill);
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        color: var(--color-primary-ink);
      }
      .photo-btn app-icon {
        --icon-stroke: 1.5;
      }
      .photo-btn:hover {
        background: var(--tile-powder);
      }
      .photo-btn input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }
      .sheet-error {
        margin: var(--space-4) 0 0;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-xs);
        background: var(--tone-danger-bg);
        border: 1px solid var(--tone-danger-border);
        color: var(--tone-danger-ink);
        font-size: 13px;
        line-height: 1.45;
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: var(--space-2);
        margin-top: var(--space-4);
      }
      /* The app's amber CTA: --color-brand-accent fill, --color-ink ink,
         --radius-sm, no border, no shadow. */
      .btn-primary {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 46px;
        min-width: 180px;
        padding: 0 22px;
        border: 0;
        border-radius: var(--radius-pill);
        background: var(--color-brand-accent);
        color: var(--color-ink);
        font: inherit;
        font-size: 14px;
        font-weight: 800;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
      }
      /* The hover is TEAL, and the focus ring goes with it.

         The same treatment the developers page's "Add developer" button gets,
         and for the same reason: a teal outline drawn AROUND a gold button
         reads as a sticker around it, while a teal fill is the button itself
         changing state. The focus state is the same fill, so the button has
         one way of saying "this is live".

         The fill change is the focus indicator WCAG 2.4.7 asks for. */
      .btn-primary:hover:not(:disabled),
      .btn-primary:focus-visible {
        background: var(--color-primary-ink);
        color: var(--color-white);
        outline: none;
      }
      .btn-primary:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .btn-primary ion-spinner {
        width: 16px;
        height: 16px;
      }
      /* The quiet one beside it: white, one hairline, no shadow. */
      .btn-quiet {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 22px;
        border: 1px solid var(--tile-powder-deep);
        border-radius: var(--radius-pill);
        background: var(--color-white);
        color: var(--color-ink-soft);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition:
          border-color 0.15s ease,
          color 0.15s ease;
      }
      .btn-quiet:hover {
        border-color: var(--color-primary-ink);
        color: var(--color-primary-ink);
      }
    `,
  ],
})
export class DeveloperFormModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly developers = inject(DeveloperService);
  private readonly uploads = inject(ImageUploadService);

  /**
   * Set by ModalController from the page that presents this modal.
   *
   * `'new'` rather than null/undefined so "adding" is an explicit value rather
   * than an absent one — the same convention `photoURL: string | null` follows.
   *
   * THIS IS A SETTER, and it has to be. Ionic's `ModalController.create()` builds
   * the overlay by constructing the component FIRST and assigning `componentProps`
   * AFTER, so a constructor that reads `this.developer` always sees `undefined`.
   * That is not hypothetical here: with the props arriving too late, Edit would
   * have opened an EMPTY form and `save()` would have fallen through to
   * `create()` - silently duplicating the record instead of editing it.
   *
   * A setter is the fix rather than ngOnInit because props are assigned through
   * Angular's input mechanism, which is guaranteed to have run by the time the
   * component is first checked - an input can never be assigned after ngOnInit.
   */
  @Input()
  set developer(value: Developer | 'new') {
    this.target = value;
    this.seedFromTarget();
  }
  get developer(): Developer | 'new' {
    return this.target;
  }

  private target: Developer | 'new' = 'new';

  protected readonly accents = DEVELOPER_ACCENTS;

  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal('');

  protected name = '';
  protected roles: string[] = [];
  protected roleDraft = '';
  protected accent = DEVELOPER_ACCENTS[0].hex;
  protected photoURL: string | null = null;

  /** True when the presenter opened this to create rather than to edit. */
  protected get isNew(): boolean {
    return this.target === undefined || this.target === 'new';
  }

  /**
   * Copies the record being edited into the form fields.
   *
   * Called from the `developer` setter, so it runs when the prop lands rather
   * than at construction. Not idempotent-by-accident either: a 'new' target
   * clears the fields, so a modal reused for a second create does not open
   * showing the previous record.
   */
  private seedFromTarget(): void {
    const target = this.target;
    if (target && target !== 'new') {
      this.name = target.name;
      this.roles = [...target.roles];
      this.accent = target.accent;
      this.photoURL = target.photoURL;
    } else {
      this.name = '';
      this.roles = [];
      this.roleDraft = '';
      this.accent = DEVELOPER_ACCENTS[0].hex;
      this.photoURL = null;
    }
  }

  // ── Roles ──────────────────────────────────────────────────────────────

  protected addRole(role: string): void {
    const trimmed = role.trim();
    // Case-insensitive, so "qa" and "QA" cannot both end up on one card.
    if (!trimmed || this.roles.some((r) => r.toLowerCase() === trimmed.toLowerCase())) return;
    this.roles = [...this.roles, trimmed];
    this.roleDraft = '';
  }

  protected removeRole(role: string): void {
    this.roles = this.roles.filter((r) => r !== role);
  }

  protected clearRoles(): void {
    this.roles = [];
  }

  // ── Photo ──────────────────────────────────────────────────────────────

  protected async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately. Without this, picking the SAME file twice in a row fires
    // no change event and the second attempt silently does nothing.
    input.value = '';
    if (!file) return;

    this.uploading.set(true);
    this.error.set('');
    try {
      this.photoURL = await this.uploads.uploadAvatar(file);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Could not upload that photo.');
    } finally {
      this.uploading.set(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────

  /**
   * Saves the form.
   *
   * Client-side validation mirrors `developerIsWellFormed()` in firestore.rules
   * deliberately. The rules are the real gate — a rule the UI duplicates is a
   * second thing to keep in step — but failing here turns a PERMISSION_DENIED
   * into a readable message instead of a generic one.
   */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    const name = this.name.trim();
    if (!name) {
      this.error.set('Enter a name.');
      return;
    }
    if (name.length > 80) {
      this.error.set('That name is longer than 80 characters.');
      return;
    }
    if (!this.roles.length) {
      this.error.set('Add at least one role.');
      return;
    }
    if (this.roles.length > 12) {
      this.error.set('Twelve roles is the limit.');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    const payload: Omit<DeveloperDoc, 'order'> = {
      name,
      roles: this.roles,
      accent: this.accent,
      photoURL: this.photoURL,
    };

    try {
      const target = this.target;
      // Narrowed on `isNew` rather than on the literal, because TS cannot follow
      // a getter back to the union member it excludes — it still sees
      // `Developer | 'new'` here and `target.id` does not exist on 'new'.
      if (target && target !== 'new') {
        await this.developers.update(target.id, payload);
      } else {
        await this.developers.create(payload);
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err: unknown) {
      this.error.set(describeFirestoreError('the developer list', err));
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    void this.modalCtrl.dismiss();
  }
}
