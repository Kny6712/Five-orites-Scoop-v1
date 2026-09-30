// src/app/features/about/about.page.ts
// Five-orites Scoop — About the App
// Author: Five-orites Scoop team (see README)
//
// All copy lives in core/about-content.ts. This class only decides how it is
// arranged, so a wording change never requires touching this file.

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton,
  IonButton, IonChip, IonLabel,
} from '@ionic/angular/standalone';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import {
  HERO, STORY, MISSION, VISION,
  CUSTOMER_FEATURES, TEAM_FEATURES, HOW_IT_WORKS, TECH_STACK,
} from '../../core/about-content';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton,
    IonButton, IonChip, IonLabel, CartButtonComponent, AppIconComponent,
  ],
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss'],
})
export class AboutPage {
  readonly hero = HERO;
  readonly story = STORY;
  readonly mission = MISSION;
  readonly vision = VISION;
  readonly customerFeatures = CUSTOMER_FEATURES;
  readonly teamFeatures = TEAM_FEATURES;
  readonly howItWorks = HOW_IT_WORKS;
  readonly techStack = TECH_STACK;
}
