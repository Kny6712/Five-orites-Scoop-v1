// src/app/shared/components/app-footer/app-footer.component.ts
// Five-orites Scoop — Site footer, on every page
//
// WHY IT LIVES IN A SHARED COMPONENT
// There was no footer anywhere in the app. The only element named one was a
// page-scoped credit block on Developers, and the only <ion-footer> was the
// action bar inside an admin modal. Every page simply ended at its last card.
//
// It has to be a component rather than a global style because an Ionic footer is
// a LAYOUT CHILD of ion-page, not a fixed overlay: it is a flex sibling of
// ion-content, so the content area shrinks to make room. That cannot be done
// from :root — it needs a real element inside each page's own ion-page.
//
// `:host { display: contents }` is load-bearing. Without it the host element
// itself becomes the flex child and the ion-footer inside it is laid out as a
// normal block — the footer still paints, but ion-page no longer treats it as
// chrome, so the content and the footer overlap. This is the same trick
// CartButtonComponent uses, and for the same reason.

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface FooterLink {
  readonly label: string;
  readonly url: string;
}

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="site-foot">
      <div class="foot-inner">
        <div class="foot-brand">
          <img
            src="assets/placeholder-scoop.svg"
            alt=""
            class="foot-logo"
            aria-hidden="true"
          />
          <div class="foot-brand-text">
            <span class="foot-name">Five-orites Scoop</span>
            <span class="foot-tag">Premium ice cream, scooped to your door</span>
          </div>
        </div>

        <nav class="foot-nav" aria-label="Site">
          @for (link of links; track link.url) {
            <a class="foot-link" [routerLink]="link.url">{{ link.label }}</a>
          }
        </nav>

        <p class="foot-copy">&copy; {{ year }} Five-orites Scoop</p>
      </div>
    </footer>
  `,
  styles: [`
    :host { display: contents; }

    /* ── Page footer ────────────────────────────────────────────────────
       A white band with a hairline top edge. Kept to a single row on a phone:
       at three lines it would take ~140px off a short viewport, which is a real
       cost on the pages that are already the longest. */
    .site-foot {
      flex: 0 0 auto;
      background: var(--color-white);
      border-top: 1px solid var(--ion-color-light-shade);
      padding: var(--space-3) var(--space-4);
    }

    .foot-inner {
      max-width: var(--container-max);
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      flex-wrap: wrap;
    }

    .foot-brand { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }

    .foot-logo {
      width: 34px;
      height: 34px;
      border-radius: var(--radius-xs);
      flex: 0 0 auto;
    }

    .foot-brand-text { display: flex; flex-direction: column; min-width: 0; }

    .foot-name {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      color: var(--color-ink);
      line-height: 1.2;
    }

    .foot-tag {
      font-size: 11px;
      color: var(--ion-color-medium);
      line-height: 1.3;
      /* The tagline is the first thing to go when the row wraps on a phone. */
      @media (max-width: 420px) { display: none; }
    }

    .foot-nav { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }

    .foot-link {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-ink-soft);
      text-decoration: none;
    }
    .foot-link:hover { color: var(--color-primary-ink); text-decoration: underline; }

    .foot-copy {
      margin: 0;
      font-size: 11px;
      color: var(--ion-color-medium);
      white-space: nowrap;
    }
  `],
})
export class AppFooterComponent {
  protected readonly year = new Date().getFullYear();

  protected readonly links: readonly FooterLink[] = [
    { label: 'Our Flavors', url: '/products' },
    { label: 'About', url: '/about' },
    { label: 'Developers', url: '/developers' },
    { label: 'Settings', url: '/settings' },
  ];
}
