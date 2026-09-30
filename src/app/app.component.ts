// src/app/app.component.ts
// Five-orites Scoop — Root App Shell with ion-split-pane + ion-menu
// Author: Five-orites Scoop team (see README)

import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonApp,
  IonSplitPane,
  IonMenu,
  IonContent,
  IonList,
  IonListHeader,
  IonItem,
  IonLabel,
  IonMenuToggle,
  IonAvatar,
  IonButton,
  IonRouterOutlet,
  MenuController,
} from '@ionic/angular/standalone';
import { AppIconComponent } from './shared/components/app-icon/app-icon.component';
import { AuthService } from './core/services/auth.service';
import { CartService } from './core/services/cart.service';
import { OrderNotificationService } from './core/services/order-notification.service';
import type { AppIcon } from './core/icons/app-icons';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface NavItem {
  title: string;
  url: string;
  /**
   * Typed as `AppIcon` rather than `string`, so renaming or removing an icon is a
   * compile error instead of a silently blank nav row.
   */
  icon: AppIcon;
  role: 'all' | 'customer' | 'admin';
  badge?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    IonApp,
    IonSplitPane,
    IonMenu,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonMenuToggle,
    IonAvatar,
    IonButton,
    IonRouterOutlet,
    AppIconComponent,
    ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  private authService = inject(AuthService);
  private cartService = inject(CartService);
  private router = inject(Router);
  private menuCtrl = inject(MenuController);
  private orderNotifications = inject(OrderNotificationService);

  currentUser = signal<import('./core/models/user.model').AppUser | null>(null);
  cartItemCount = signal(0);

  readonly customerNavItems: NavItem[] = [
    { title: 'Dashboard', url: '/dashboard', icon: 'home', role: 'all' },
    { title: 'Our Flavors', url: '/products', icon: 'ice-cream', role: 'all' },
    { title: 'My Cart', url: '/cart', icon: 'cart', role: 'customer', badge: true },
    { title: 'My Orders', url: '/orders', icon: 'receipt', role: 'customer' },
    // 'all', not 'customer': an admin is a signed-in user with a profile, and the
    // profile page is role-agnostic by design. Gating it to customers would hide
    // it from exactly the people most likely to want to fix their own name.
    { title: 'My Profile', url: '/profile', icon: 'user', role: 'all' },
    { title: 'About', url: '/about', icon: 'info', role: 'all' },
    { title: 'Developers', url: '/developers', icon: 'users', role: 'all' }];

  readonly adminNavItems: NavItem[] = [
    { title: 'Inventory', url: '/admin/inventory', icon: 'layers', role: 'admin' },
    { title: 'Fulfillment', url: '/admin/orders', icon: 'clipboard', role: 'admin' },
    { title: 'Tracking', url: '/admin/tracking', icon: 'map', role: 'admin' },
    { title: 'Analytics', url: '/admin/analytics', icon: 'chart', role: 'admin' },
    { title: 'Vouchers', url: '/admin/vouchers', icon: 'ticket', role: 'admin' },
    { title: 'Users', url: '/admin/users', icon: 'users', role: 'admin' }];

  isAdmin = computed(() => this.currentUser()?.role === 'admin');

  /**
   * Nav items the current user may actually see.
   *
   * `role` used to be declared on NavItem but never read, so signed-out guests
   * were shown "My Cart" / "My Orders" and got redirected to /auth on tap.
   *
   * Admins also get the customer items. They are signed in, the cart and orders
   * routes are behind authGuard only, and an admin has to be able to walk the
   * buying flow to check a price or photo edit they just made. Guests still see
   * neither, which is the case that bug was actually about.
   */
  visibleCustomerNavItems = computed(() => {
    const user = this.currentUser();
    const role = user?.role ?? 'guest';
    return this.customerNavItems.filter(
      (item) =>
        item.role === 'all' ||
        item.role === role ||
        (role === 'admin' && item.role === 'customer')
    );
  });

  constructor() {
    this.authService.currentUser$
      .pipe(takeUntilDestroyed())
      .subscribe((user) => {
        this.currentUser.set(user);
        // Point the status watcher at whoever is signed in, so a status change
        // notifies the order's owner on THEIR device instead of the device that
        // performed the change.
        this.orderNotifications.watch(user?.uid ?? null);
      });

    this.cartService.cart$
      .pipe(takeUntilDestroyed())
      .subscribe((cart) => this.cartItemCount.set(cart.itemCount));
  }

  ngOnInit(): void {}

  /**
   * Accessible name for a nav row.
   *
   * The count bubble is `aria-hidden` decoration now that it overlaps the icon
   * instead of sitting in the end slot, so the item count would otherwise drop
   * out of the accessible name entirely. Folding it in here keeps "My Cart, 2
   * items" as one announcement rather than a bare "My Cart".
   */
  navItemLabel(item: NavItem): string {
    const n = this.cartItemCount();
    if (!item.badge || n <= 0) return item.title;
    return `${item.title}, ${n} item${n === 1 ? '' : 's'}`;
  }

  getUserInitials(): string {
    const name = this.currentUser()?.displayName ?? '';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  async logout(): Promise<void> {
    try {
      await this.authService.signOut();
      await this.menuCtrl.close();
      await this.router.navigate(['/auth']);
    } catch (err) {
      console.error('Logout error:', err);
    }
  }
}
