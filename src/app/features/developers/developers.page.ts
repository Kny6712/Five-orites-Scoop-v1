// src/app/features/developers/developers.page.ts
// Five-orites Scoop — Team Credits Page
// Author: Five-orites Scoop team (see README)

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonGrid, IonRow, IonCol,
  IonCard, IonCardContent, IonAvatar,
  IonChip, IonLabel, } from '@ionic/angular/standalone';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';

interface Developer {
  name: string;
  initials: string;
  roles: string[];
  accent: string;
}

@Component({
  selector: 'app-developers',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonGrid, IonRow, IonCol,
    IonCard, IonCardContent, IonAvatar,
    IonChip, IonLabel, CartButtonComponent,
    AppIconComponent, AppFooterComponent],
  templateUrl: './developers.page.html',
  styleUrls: ['./developers.page.scss'],
})
export class DevelopersPage {
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
  readonly developers: Developer[] = [
    {
      name: 'Kenn Karlo Umadhay',
      initials: 'KK',
      roles: ['Main Project Lead', 'Full Stack Dev', 'UI/UX Designer Lead', 'QA', 'Documentation'],
      accent: '#CFE4F2', // tile-powder
    },
    {
      name: 'Heaven Alvior',
      initials: 'HA',
      roles: ['QA', 'Documentation'],
      accent: '#CDEAD9', // tile-mint
    },
    {
      name: 'Justin Curby P. Esguerra',
      initials: 'JE',
      roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
      accent: '#F8D2DD', // tile-blush
    },
    {
      name: 'Renz Gabriel De la Cruz',
      initials: 'RD',
      roles: ['QA', 'Documentation'],
      accent: '#FBE9BE', // tile-lemon
    },
    {
      name: 'Antonio Miguel Villanueva',
      initials: 'AV',
      roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
      accent: '#D3DDF7', // tile-periwinkle
    }];

  getRoleColor(role: string): string {
    if (role.includes('Lead')) return 'primary';
    if (role.includes('Full Stack')) return 'secondary';
    if (role.includes('UI/UX')) return 'tertiary';
    if (role === 'QA') return 'warning';
    return 'medium';
  }

  readonly currentYear = new Date().getFullYear();

}
