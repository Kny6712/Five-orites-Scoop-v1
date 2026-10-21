// src/app/shared/components/admin/staff-reply.component.ts
// Five-orites Scoop — A public staff reply on a customer review
//
// WHY A SHARED COMPONENT
// A staff reply is WRITTEN in the admin moderation queue and READ on the
// product page. Two pages, one message — and it has to look the same in both,
// or the admin is not seeing what the customer sees.
//
// The product page's stylesheet already said this out loud about the review
// itself: ".review-author and .review-comment are the definitions from the
// moderation queue copied verbatim — the same review should not look like two
// different reviews because it is being read in a different place." Copying
// the REPLY into both pages is that same mistake wearing a different hat, so
// this is a component and both pages use it.
//
// It also fixes a lie. The moderation queue's own note said "Replying is
// public — the customer sees it on their product page", and it did not: the
// product page never drew `adminResponse` at all, so a published reply went
// into a void. Rendering it here is the other half of that sentence.
//
// ── Why it looks the way it does ────────────────────────────────────────────
//
// A MINT FILL, because the reply has to be distinguishable from the
// customer's words at a glance — it is a different voice, not a paragraph of
// the same one. The pale mint is the app's `--tile-mint`, and it is the colour
// the staff side of this app already speaks in.
//
// A 1px RIM, NOT A 4px BAR. The block used to carry a four-pixel saturated
// mint bar down its left edge, which was the closest thing the admin pages
// had to a bevel: a heavy edge on a soft field, reading as a raised panel. The
// rim carries the same information in one pixel.
//
// THE RIM, NOT THE FILL, IS WHAT MAKES THE BLOCK VISIBLE. `--tile-mint` is
// #E4F6EA and the card it sits in is white, and that pair measures 1.13:1 —
// under the 1.15:1 the app's own banner surfaces have to clear against a white
// card, which is why the four-pixel bar existed. The rim is what gives the
// block a definite edge against the card, and the fill is left to do the
// other job, which is to say "this is the shop". The same reasoning the
// contrast gate applies to the dashboard's KPI tiles: a fill that cannot carry
// the edge is drawn with a rim precisely because of that.
//
// The label is `--color-mint-ink` on that fill (5.17:1) and the reply text is
// solid plum (11.45:1). Both are asserted in check-contrast.mjs.

import { Component, input } from '@angular/core';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';

@Component({
  selector: 'app-staff-reply',
  standalone: true,
  imports: [AppIconComponent],
  template: `
    <div class="reply">
      <p class="reply-tag">
        <app-icon name="shield-check" class="reply-icon" />
        <span>{{ name() }} replied</span>
      </p>
      <p class="reply-text">{{ text() }}</p>
      <!--
        The admin queue's "Remove reply" action is projected in rather than
        being built here: it exists on the moderation queue and nowhere else,
        and the PRODUCT page has no such action. A content slot with a
        selector means the customer page simply does not pass one, and the
        button's own styles stay in the admin page's stylesheet — projected
        content belongs to the parent, not to the component it lands in.
      -->
      <ng-content select="[replyAction]" />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .reply {
        margin-top: 10px;
        padding: 10px 12px;
        background: var(--tile-mint);
        border: 1px solid var(--color-brand-secondary);
        border-radius: var(--radius-sm);
      }

      .reply-tag {
        display: flex;
        align-items: center;
        gap: 5px;
        margin: 0 0 3px;
        font-size: 11px;
        font-weight: 700;
        color: var(--color-mint-ink);
      }

      .reply-icon {
        --icon-size: 13px;
        flex: 0 0 auto;
      }

      .reply-text {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-ink);
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class StaffReplyComponent {
  /** Who replied. Defaults to the shop's name, which is what an old reply says. */
  readonly name = input<string>('Five-orites Scoop');

  /** The reply itself. */
  readonly text = input.required<string>();
}
