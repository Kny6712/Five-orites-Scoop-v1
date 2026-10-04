// src/app/features/about/about.page.ts
// Five-orites Scoop — About the App
// Author: Five-orites Scoop team (see README)
//
// All copy lives in core/about-content.ts. This class only decides how it is
// arranged, so a wording change never requires touching this file.

import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonChip,
  IonLabel,
} from '@ionic/angular/standalone';
import { CartButtonComponent } from '../../shared/components/cart-button/cart-button.component';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import {
  ScoopMapComponent,
  type MapMarker,
} from '../../shared/components/scoop-map/scoop-map.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { SHOP_LOCATION, SHOP_HOURS } from '../../core/config/shop.config';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import {
  HERO,
  STORY,
  MISSION,
  VISION,
  CUSTOMER_FEATURES,
  TEAM_FEATURES,
  HOW_IT_WORKS,
  TECH_STACK,
} from '../../core/about-content';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonChip,
    IonLabel,
    CartButtonComponent,
    AppIconComponent,
    ScoopMapComponent,
    AppFooterComponent,
  ],
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss'],
})
export class AboutPage {
  private readonly shopSettings = inject(ShopSettingsService);

  readonly hero = HERO;
  readonly story = STORY;
  readonly mission = MISSION;
  readonly vision = VISION;
  readonly customerFeatures = CUSTOMER_FEATURES;
  readonly teamFeatures = TEAM_FEATURES;
  readonly howItWorks = HOW_IT_WORKS;
  readonly techStack = TECH_STACK;

  readonly shop = SHOP_LOCATION;
  readonly hours = SHOP_HOURS;

  /**
   * The shop's contact number, admin-editable and actually displayed.
   *
   * `ShopSettingsService.contactPhone` was WRITE-ONLY: an admin could type a
   * number into Admin → Settings, it persisted correctly, and nothing in the app
   * ever read it back — so it appeared nowhere. The About page bound
   * `SHOP_HOURS.phone` instead, which is `''`, rendering an empty line.
   *
   * A customer who wants to phone the shop had no way to find the number anywhere
   * in the app. This is the one surface that should carry it.
   *
   * Empty until an admin fills it in, and the template hides the whole row rather
   * than printing a blank — so the fallback chain ends at the config value
   * without ever rendering nothing.
   */
  readonly contactPhone = computed(
    () => this.shopSettings.settings().contactPhone.trim() || SHOP_HOURS.phone,
  );

  /**
   * One pin, on the same OpenStreetMap the app already uses for delivery.
   *
   * Reusing ScoopMapComponent rather than embedding a second map means the tile
   * layer, the attribution and the pin styling are all shared with the tracking
   * pages — and the coordinates come from SHOP_LOCATION, so "where the shop is"
   * is still stated in exactly one place in the codebase.
   */
  readonly shopMarkers: MapMarker[] = [
    {
      id: 'shop',
      lat: SHOP_LOCATION.lat,
      lng: SHOP_LOCATION.lng,
      label: SHOP_LOCATION.name,
      detail: SHOP_LOCATION.address,
      tone: 'primary',
    },
  ];
}
