// src/app/core/services/catalog/quick-view.service.ts
// Five-orites Scoop — The flavour quick-view
//
// WHY A SERVICE, AND WHY IT LIVES IN THE SHELL
//
// The quick-view is a dialog over the flavours list, and a dialog has to
// float over the whole app — including the sidebar, which is the one piece
// of chrome that is NOT inside the routed page.
//
// The first attempt hosted it in the products page's own template, and that
// put it in the wrong place twice over:
//
//  - `ion-router-outlet` carries a transform, and a transformed element is
//    the containing block for its fixed-position descendants. The dialog was
//    therefore "fixed" to the CONTENT AREA, not the window: it was centred
//    on the outlet, 980px wide, and it ran off the right edge of the screen.
//    The dim had the same fault — it stopped at the sidebar's edge, so half
//    the screen was dimmed and half was not.
//
//  - Even with the geometry fixed, a dialog that lives inside a routed page
//    cannot be reached from the shell, and the shell is where the sidebar and
//    the outlet live.
//
// So the state lives here, in one place, and the SHELL renders the dialog.
// The page asks for a flavour; the shell shows it over everything.

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class QuickViewService {
  /** The flavour on show, or null when nothing is open. */
  private readonly openId = signal<string | null>(null);
  readonly productId = this.openId.asReadonly();

  /** Opens the quick-view on a flavour. An empty id opens nothing. */
  open(productId: string): void {
    if (productId) this.openId.set(productId);
  }

  /** Closes the quick-view. */
  close(): void {
    this.openId.set(null);
  }
}
