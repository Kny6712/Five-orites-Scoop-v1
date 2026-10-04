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

  getRoleColor(role: string): string {
    if (role.includes('Lead')) return 'primary';
    if (role.includes('Full Stack')) return 'secondary';
    if (role.includes('UI/UX')) return 'tertiary';
    if (role === 'QA') return 'warning';
    return 'medium';
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
