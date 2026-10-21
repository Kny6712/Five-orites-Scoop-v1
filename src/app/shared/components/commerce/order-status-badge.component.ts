// src/app/shared/components/commerce/order-status-badge.component.ts
// Five-orites Scoop — Order Status Badge Component
// Author: Five-orites Scoop team (see README)

import { Component, Input } from '@angular/core';
import { NgClass } from '@angular/common';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { OrderStatus, ORDER_STATUS_META } from '@core/models/order.model';

@Component({
  selector: 'app-order-status-badge',
  standalone: true,
  imports: [NgClass, AppIconComponent],
  template: `
    <!--
      Explicit tone classes, NOT [color]="chipColor".

      Ionic's color input chooses a foreground AND a background from one name with no
      relationship between them, which is why "Order Placed" measured 1.31:1 and
      "Preparing Your Scoops" 1.14:1 - the label and the pill within a percent of the
      same lightness.

      This is the third and widest instance of the same defect (after the credits chips
      and the inventory chips), and it was invisible for longer than either: this
      component renders on four pages, all of which were auth-gated or empty, so no
      audit could reach it until the emulator had orders in it.

      The tone classes still do the work they did when this was an ion-chip: they
      set "background" and "border" directly, so they are unchanged by the element
      swap. Only "--color" had to become "color", below, because --color was the
      custom property ion-chip painted its label from.
    -->
    <!--
      A PLAIN <span>, NOT AN <ion-chip>, and this is the third and widest instance
      of a decision this codebase has already made twice (admin-reviews.page.scss
      "a real <button> with aria-pressed, not an ion-chip"; admin-tracking
      "real <button>s rather than ion-chips") plus once more on this very row,
      where the Cancel control is a plain <button> because "an ion-button brings
      its own padding, radius and inner shadow DOM, every one of which has to be
      overridden... and every override is somewhere the pill can leak."

      THE REASON THIS ONE HAD TO CHANGE. "ion-chip" declares a hard
      "border-radius: 16px" and exposes NO "--border-radius" custom property, so
      there is no supported way to change it. Declaring "--radius-chip" here on
      ".status-chip" produced a rule that was measurably present in the built
      bundle (it survives into chunk-*.js) and visibly did nothing: Ionic attaches
      that host stylesheet lazily, when the chip first renders, from outside
      Angular, and it won. "!important" would have worked and is the wrong answer -
      it would be a permanent fight with a third-party stylesheet, and the three
      precedents above all chose the same way out instead.

      The box itself (padding, min-height, inline-flex, box-sizing) is the global
      ".chip" class, which reproduces ion-chip's values exactly so the six measured
      widths - 102.6 / 104.0 / 106.8 / 121.7 / 137.8 / 173.5px - still hold. See
      global.scss for the copy.

      "<ion-label>" became "<span class=status-text>" for the same reason: it was
      another Ionic element with its own display rules, and the label is text.

      NO BACKTICKS IN THIS BLOCK EITHER - it is inside the same template literal
      as the styles array below, so a backtick here ends the template and the
      parser reports a comma expected several lines further on.
    -->
    <span [ngClass]="statusClass" class="chip status-chip">
      <app-icon [name]="statusMeta.icon" class="status-icon" />
      <span class="status-text">{{ statusMeta.label }}</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      /* NOTHING HERE DECLARES THE BOX. Padding, min-height, inline-flex,
         box-sizing, the 12px radius, the margin reset and the no-squeeze pair all
         come from the global ".chip" class, which copies ion-chip's values so the
         six measured widths still hold. This file is now only the things that are
         specific to a STATUS: its type, its six tones, and its icon gutter.

         It also no longer has to fight anything. The first version of this rule
         declared its own border-radius and margin, was measurably present in the
         built bundle, and visibly did nothing — because "ion-chip" attaches a host
         stylesheet containing a hard "border-radius: 16px" lazily, at first render,
         from outside Angular, and no class rule in here can outrank it. See the
         template comment for the whole argument and the two precedents that had
         already reached the same conclusion.

         NO BACKTICKS IN THIS BLOCK, and that is not a stylistic accident: these
         styles are a TypeScript TEMPLATE LITERAL, so a backtick in a comment ends
         the stylesheet and the parser reports a comma expected somewhere further
         down. Code references here are in double quotes, as they always have been
         in this file. */
      /* THE CHIP IS THEMEABLE FROM OUTSIDE, through three custom properties.

         A host can now say "this chip is interactive" — the admin queue's
         status column sets "--chip-border-color" and "--chip-ink" on hover, and the
         chip answers. Before this, it could not: the fill and the rim were
         declared straight onto the chip by the tone classes, so nothing
         outside this component could touch them, and the admin queue had to
         hang a separate caret off the pill to have anything to hover.

         The tone classes now set "--chip-bg" and "--chip-border" and this rule
         paints them, which is the same arrangement as a CSS variable theme:
         the value lives with the thing that knows it, and the thing that
         consumes it can be overridden by any ancestor.

         CUSTOM PROPERTIES INHERIT THROUGH ENCAPSULATION. Angular's emulated
         encapsulation rewrites selectors and stamps attributes; it does not
         block inheritance, so a "--chip-border-color" set on the <app-order-status-badge>
         HOST reaches the chip inside. That is the whole reason this works
         without ::ng-deep. */
      .status-chip {
        /* Named, not left to inheritance. The chip was an ion-chip, which paints
           its label from the "--color" custom property, so this block set that
           and not "color". Nothing reads --color now, so it is a plain declaration
           like every other ink in the app — and a --color left behind here would
           be a dead custom property that reads as live.

           The ink is now a property rather than a constant, so a host can
           deepen the whole chip on hover without touching this file. */
        color: var(--chip-ink, var(--color-ink));
        font-size: 12px;
        font-weight: 600;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);

        /* THE HOVER OVERRIDE, AND IT IS A SEPARATE PROPERTY ON PURPOSE.

         "--chip-border" is declared ON the chip, by its tone class — and a
         declaration on an element always beats one inherited from an
         ancestor. So a host restating "--chip-border" would lose to the
         chip's own tone and nothing would happen.

         "--chip-border-color" is declared nowhere on the chip, so it arrives
         from the host by inheritance, and because it is the more specific
         SOURCE it wins the "border-color" declaration below. It is the same
         trick as a CSS variable theme, where an override property sits
         alongside a base one. */
        border-color: var(--chip-border-color, var(--chip-border));
      }

      /* The label. An <ion-label> until the element swap, and it is a plain span
         now, so this is where the ink lands. Kept as its own rule rather than
         inherited so that a future tone class can override the LABEL without also
         recolouring the icon — which is the opposite of what an ink on the chip
         itself would do.

         "--chip-label-ink" falls back to "--chip-ink" and then to the plum, so
         the two properties are independent but default to the same thing. */
      .status-text {
        color: var(--chip-label-ink, var(--chip-ink, var(--color-ink)));
      }

      /* One background per state, one foreground for all of them. Ink on every one of
         these surfaces clears 4.5:1 by a wide margin: 11.19 on the info tint, 11.45 on
         mint, 6.35 on success, 6.29 on warning, 7.42 on danger.

         THESE DECLARE PROPERTIES, NOT PAINT. The fill and the rim are handed to
         the chip as "--chip-bg" and "--chip-border" and the chip paints them
         above, so a host can restate either one without touching this file.
         The VALUES are unchanged — the same tokens on the same six states —
         so every measured width and every contrast pair still holds. */
      .st-pending {
        --chip-bg: var(--tone-warning-bg);
        --chip-border: var(--tone-warning-border);
      }
      .st-confirmed {
        --chip-bg: var(--tone-info-bg);
        --chip-border: var(--tone-info-border);
      }
      .st-preparing {
        --chip-bg: var(--tile-powder);
        --chip-border: var(--tone-info-border);
      }
      .st-delivery {
        --chip-bg: var(--tile-mint);
        --chip-border: var(--tone-success-border);
      }
      .st-delivered {
        --chip-bg: var(--tone-success-bg);
        --chip-border: var(--tone-success-border);
      }
      .st-cancelled {
        --chip-bg: var(--tone-danger-bg);
        --chip-border: var(--tone-danger-border);
      }
      .status-icon {
        margin-right: 4px;

        /* 20px is app-icon's own default ("--icon-size", app-icon.component.ts),
           and this rule does NOT set it — which is the correction. The customer
           ledger's column note claimed a "16px icon" here for years, on the
           strength of ion-chip's "::slotted(ion-icon) { font-size: 1.4286em }",
           which never applied here at all: app-icon renders an inline <svg>, not
           an <ion-icon>, so that slotted rule had no target. The icon was always
           20px and the note was always wrong.

           Left at 20px rather than "fixed" to 16px, because 20px is what the six
           measured chip widths (102.6 to 173.5px) were taken at, and the Status
           column is 182px. Dropping the icon to 16px would narrow every chip by 4px
           and silently invalidate that column for no gain: the chip is 32px tall
           either way, since 20px of icon plus 6px of padding each side is exactly
           the min-height. Change it only as a deliberate design decision, and
           re-measure the widths in the same commit. */
      }
    `,
  ],
})
export class OrderStatusBadgeComponent {
  @Input({ required: true }) status!: OrderStatus;

  get statusMeta() {
    return ORDER_STATUS_META[this.status];
  }

  /**
   * The tone a status chip wears, as a class rather than an Ionic colour name.
   *
   * This returned 'warning' | 'primary' | 'secondary' | 'tertiary' | 'success' |
   * 'danger', which the template handed to `[color]`. Ionic then derived BOTH the
   * label colour and the pill background from that one name, choosing among its own
   * tint shades with no contrast relationship between them - measured at 1.31:1 and
   * 1.14:1 for the two states above.
   *
   * `out_for_delivery` gets its own mint tint rather than sharing 'confirmed', because
   * a class hands the stylesheet both halves of the pair at once and six states
   * squeezed into five colours is how the collision started.
   */
  get statusClass(): string {
    switch (this.status) {
      case 'pending':
        return 'st-pending';
      case 'confirmed':
        return 'st-confirmed';
      case 'preparing':
        return 'st-preparing';
      case 'out_for_delivery':
        return 'st-delivery';
      case 'delivered':
        return 'st-delivered';
      default:
        return 'st-cancelled';
    }
  }
}
