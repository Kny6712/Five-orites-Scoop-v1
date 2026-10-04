// src/app/features/developers/developers.page.ts
// Five-orites Scoop — Team Credits Page
// Author: Five-orites Scoop team (see README)

import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardContent,
  IonAvatar,
  IonChip,
  IonLabel,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { CloudinaryPipe } from '../../shared/pipes/cloudinary.pipe';
import { DeveloperService } from '../../core/services/developer.service';
import { initialsOf } from '../../core/logic/flavor';
import type { Developer } from '../../core/models/developer.model';

@Component({
  selector: 'app-developers',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardContent,
    IonAvatar,
    IonChip,
    IonLabel,
    CartButtonComponent,
    AppIconComponent,
    AppFooterComponent,
    CloudinaryPipe,
  ],
  templateUrl: './developers.page.html',
  styleUrls: ['./developers.page.scss'],
})
export class DevelopersPage implements OnInit, OnDestroy {
  /**
   * Avatar disc colours.
   *
   * All five were previously a set of fully saturated, unrelated hues — a
   * saturated violet, an amber, a teal, an orange and a green — behind white
   * initials. Each one was a different design system dropped onto the same card
   * grid, and none of them came from the palette.
   *
   * They are now five steps of the app's own surfaces, so the row reads as one
   * set. Because the palette is pastel, the initials are plum on each rather
   * than white, which clears AA on every one of them.
   */

  /**
   * The tint a role's chip wears, as a class rather than an Ionic colour name.
   *
   * This used to return an Ionic colour name — `primary`, `secondary`,
   * `tertiary`, `warning`, `medium` — which the template passed to `[color]`. Ionic
   * then derived BOTH the chip background and the label colour from that one name,
   * choosing among its own tint shades with no contrast relationship between them.
   * Measured off the live page, all five role chips came out between 1.11:1 and
   * 3.67:1: the text was the same lightness as the pill behind it.
   *
   * A class hands the SCSS both halves at once, so the pair is a decision someone
   * can read next to the palette instead of an Ionic lookup nobody sees. Every
   * foreground here is `--color-ink`, which `check-contrast.mjs` already asserts
   * against each of these surfaces at 4.5:1 or better.
   *
   * Unknown roles fall through to `role-plain` rather than getting a hue of their
   * own — a neutral chip is legible, and inventing a fifth tint would put a new
   * unchecked pair into the page every time somebody adds a role.
   */
  roleClass(role: string): string {
    if (role.includes('Lead')) return 'role-lead';
    if (role.includes('Full Stack')) return 'role-dev';
    if (role.includes('UI/UX')) return 'role-design';
    if (role === 'QA') return 'role-qa';
    return 'role-plain';
  }

  /**
   * The credits, from Firestore.
   *
   * These were five object literals in this component. That made a misspelled name
   * or a replaced photo a developer task — a rebuild and a deploy — when the person
   * who most needs to fix it is the owner. They are documents now, editable from
   * /admin/developers, with `firestore.rules` doing the actual gating.
   *
   * `usingFallback` is surfaced rather than swallowed: when the read fails the
   * service stands in the built-in list, and a public page showing last-shipped
   * names should not pretend they are live.
   */
  private readonly developersService = inject(DeveloperService);
  readonly developers = this.developersService.developers;
  readonly usingFallback = this.developersService.usingFallback;

  private unsubscribe?: () => void;

  ngOnInit(): void {
    this.unsubscribe = this.developersService.watch();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  /** Initials derived from the name, not stored — see core/logic/flavor.ts. */
  initialsFor(dev: Developer): string {
    return initialsOf(dev.name);
  }

  readonly currentYear = new Date().getFullYear();
}
