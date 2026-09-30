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
    AppIconComponent],
  templateUrl: './developers.page.html',
  styleUrls: ['./developers.page.scss'],
})
export class DevelopersPage {
  readonly developers: Developer[] = [
    {
      name: 'Kenn Karlo Umadhay',
      initials: 'KK',
      roles: ['Main Project Lead', 'Full Stack Dev', 'UI/UX Designer Lead', 'QA', 'Documentation'],
      accent: '#6B3FA0',
    },
    {
      name: 'Heaven Alvior',
      initials: 'HA',
      roles: ['QA', 'Documentation'],
      accent: '#F4A435',
    },
    {
      name: 'Justin Curby P. Esguerra',
      initials: 'JE',
      roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
      accent: '#00838f',
    },
    {
      name: 'Renz Gabriel De la Cruz',
      initials: 'RD',
      roles: ['QA', 'Documentation'],
      accent: '#E65100',
    },
    {
      name: 'Antonio Miguel Villanueva',
      initials: 'AV',
      roles: ['Full Stack Dev', 'UI/UX Designer', 'QA', 'Documentation'],
      accent: '#2E7D32',
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
