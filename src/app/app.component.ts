// src/app/app.component.ts
// Five-orites Scoop — Root App Shell with ion-split-pane + ion-menu
// Author: Five-orites Scoop team (see README)

import { Component, inject, signal, computed } from '@angular/core';
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
import {
  can,
  isStaffRole,
  asRole,
  ROLE_RANK,
  type Capability,
  type UserRole,
} from './core/models/user.model';
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
  /**
   * The capability this row requires, for the ADMIN section.
   *
   * Added with role tiers: a `manager` reaches Inventory but not Users, so a
   * single `role: 'admin'` flag can no longer describe the admin nav. Absent
   * means "the customer list", which is where it has always applied.
   */
  capability?: Capability;
  /**
   * Minimum rank for this row, when a CAPABILITY cannot express it.
   *
   * Exactly one row uses it: editing the public credits, which `manager` may do and
   * `admin` may not. There is no capability with that shape, and adding one would
   * force it onto `admin` anyway — `tests/logic.test.ts` asserts the ladder
   * invariant. So this row is gated by rank, matching `teamGuard()` in
   * admin.guard.ts and `canManageTeam()` in firestore.rules.
   */
  minRole?: UserRole;
  /**
   * The count to show on this row's icon, or absent for no badge.
   *
   * Was `badge?: boolean` with the number read from a single `cartItemCount()`
   * signal, which only worked because exactly one row had a badge. The second
   * badge is the unread-notification count, and it comes from a different place,
   * so the flag had to become the value: a boolean next to a hard-coded count is
   * how "My Cart" ends up showing the notification total.
   *
   * A function rather than a number so the badge tracks the signal it reads —
   * an `item` object in a `readonly` array is built once, so a captured number
   * would be frozen at construction and never update.
   */
  badgeCount?: () => number;
  /**
   * Plural noun for the badge, used in the row's accessible name.
   *
   * Needed because the two badges count different things: 3 in the cart is "3
   * items", 3 on the bell is "3 unread". A shared noun produces "Notifications,
   * 3 items", which is precisely the kind of announcement that makes a screen
   * reader user distrust the whole menu.
   */
  badgeNoun?: string;
  /**
   * Hidden from the drawer when the viewer is staff. The route stays
   * reachable — this only removes the shortcut, and only for staff. See
   * `visibleCustomerNavItems` for why the cart specifically.
   */
  hideForStaff?: boolean;
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
export class AppComponent {
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
    {
      title: 'My Cart',
      url: '/cart',
      icon: 'cart',
      role: 'customer',
      badgeCount: () => this.cartItemCount(),
      badgeNoun: 'item',
      hideForStaff: true,
    },
    { title: 'My Orders', url: '/orders', icon: 'receipt', role: 'customer' },
    {
      // Next to My Orders rather than at the end of the list, because the feed is
      // a view OF the orders. Anyone looking for "what happened to my order"
      // reaches for the order list, and the notifications row is the answer to
      // the next question they ask.
      title: 'Notifications',
      url: '/notifications',
      icon: 'bell',
      role: 'customer',
      badgeCount: () => this.orderNotifications.unreadCount(),
      badgeNoun: 'unread notification',
    },
    // 'all', not 'customer': an admin is a signed-in user with a profile, and the
    // profile page is role-agnostic by design. Gating it to customers would hide
    // it from exactly the people most likely to want to fix their own name.
    { title: 'My Profile', url: '/profile', icon: 'user', role: 'all' },
    { title: 'About', url: '/about', icon: 'info', role: 'all' },
    { title: 'Developers', url: '/developers', icon: 'users', role: 'all' },
    { title: 'Settings', url: '/settings', icon: 'settings', role: 'all' },
  ];

  readonly adminNavItems: NavItem[] = [
    {
      title: 'Inventory',
      url: '/admin/inventory',
      icon: 'layers',
      role: 'admin',
      capability: 'manage_inventory',
    },
    {
      title: 'Fulfillment',
      url: '/admin/orders',
      icon: 'clipboard',
      role: 'admin',
      capability: 'manage_orders',
    },
    {
      title: 'Tracking',
      url: '/admin/tracking',
      icon: 'map',
      role: 'admin',
      capability: 'manage_orders',
    },
    {
      title: 'Reviews',
      url: '/admin/reviews',
      icon: 'star',
      role: 'admin',
      capability: 'moderate_reviews',
    },
    {
      title: 'Analytics',
      url: '/admin/analytics',
      icon: 'chart',
      role: 'admin',
      capability: 'view_analytics',
    },
    {
      title: 'Vouchers',
      url: '/admin/vouchers',
      icon: 'ticket',
      role: 'admin',
      capability: 'manage_vouchers',
    },
    {
      title: 'Users',
      url: '/admin/users',
      icon: 'users',
      role: 'admin',
      capability: 'manage_users',
    },
    {
      title: 'Settings',
      url: '/admin/settings',
      icon: 'settings',
      role: 'admin',
      capability: 'manage_settings',
    },
    {
      // Manager and owner, NOT admin. Gated by rank because no capability has that
      // shape — see the note on NavItem.minRole.
      title: 'Team Credits',
      url: '/admin/developers',
      icon: 'users',
      role: 'admin',
      minRole: 'manager',
    },
  ];

  /**
   * Any staff role — i.e. someone who reaches the admin area at all.
   *
   * This is what the drawer's admin section and the `/admin` route use. It is a
   * CAPABILITY check rather than a role comparison, so adding a tier later does
   * not require hunting for every `role === 'admin'`.
   */
  isAdmin = computed(() => isStaffRole(this.currentUser()?.role));

  /** Whether the signed-in user holds a specific capability. */
  can(capability: Capability): boolean {
    return can(this.currentUser()?.role, capability);
  }

  /**
   * Admin rows this user may actually see.
   *
   * Filtering the DRAWER is a convenience, not a security control — the routes
   * and the Firestore rules are the boundaries. Hiding a row a user cannot open
   * anyway is about not offering an action that cannot work.
   */
  readonly visibleAdminNavItems = computed(() =>
    this.adminNavItems.filter((item) => {
      // `minRole` is checked alongside `capability`, not instead of it: a row may
      // legitimately need both, and a row with only one must not be hidden by the
      // other's absence.
      if (item.capability && !this.can(item.capability)) return false;
      if (item.minRole) {
        const rank = ROLE_RANK[asRole(this.currentUser()?.role)];
        if (rank < ROLE_RANK[item.minRole]) return false;
      }
      return true;
    }),
  );

  /**
   * Nav items the current user may actually see.
   *
   * `role` used to be declared on NavItem but never read, so signed-out guests
   * were shown "My Cart" / "My Orders" and got redirected to /auth on tap.
   *
   * Admins also get the customer items — they are signed in, the routes are
   * behind authGuard only, and an admin has to be able to walk the buying flow to
   * check a price or photo edit they just made. EXCEPT the cart, which is
   * `hideForAdmin`.
   *
   * The cart is hidden from admins on purpose, and the reason is that the admin
   * UI is not a shopping UI: an admin works out of Inventory, Fulfillment,
   * Tracking, Analytics, Vouchers and Users. A "My Cart" row in that drawer
   * invites the one thing an admin should not be doing while holding admin
   * rights — buying stock at retail and then approving orders. The route itself
   * stays open (authGuard only, unchanged) so an admin who genuinely needs to
   * test the buying flow can still navigate to /cart directly; this only removes
   * the shortcut. The same reasoning removed the cart button from the four admin
   * toolbars.
   *
   * "My Orders" stays visible: an admin does need to see their own orders, and
   * unlike the cart, placing one is not a conflict of interest.
   */
  visibleCustomerNavItems = computed(() => {
    const user = this.currentUser();
    const role = user?.role ?? 'guest';
    // "Is staff", not "is exactly admin" — a `staff` account must not be shown a
    // shopping cart for the same reason an `owner` is not.
    const staff = isStaffRole(user?.role);
    return this.customerNavItems.filter(
      (item) =>
        !(staff && item.hideForStaff) &&
        (item.role === 'all' || item.role === role || (staff && item.role === 'customer')),
    );
  });

  constructor() {
    this.authService.currentUser$.pipe(takeUntilDestroyed()).subscribe((user) => {
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

  /**
   * Closes the side drawer after navigating from the profile panel.
   *
   * On a phone the menu is an overlay, so routing from inside it without closing
   * leaves the drawer covering the page the user just asked for. On `md` and up
   * `ion-split-pane` makes the menu persistent and this is a no-op, which is why it
   * is safe to call unconditionally. The nav rows deliberately do NOT do this —
   * they use `ion-menu-toggle auto-hide="false"` — so this is a separate tap target
   * with its own behaviour rather than a change to those.
   */
  closeMenu(): void {
    void this.menuCtrl.close();
  }

  /**
   * Accessible name for a nav row.
   *
   * The count bubble is `aria-hidden` decoration now that it overlaps the icon
   * instead of sitting in the end slot, so the item count would otherwise drop
   * out of the accessible name entirely. Folding it in here keeps "My Cart, 2
   * items" as one announcement rather than a bare "My Cart".
   *
   * The count and the noun both come from the item, never from a shared field.
   * This used to read `cartItemCount()` unconditionally, which was correct only
   * while the cart was the single badged row — the moment the bell got a badge
   * too, "Notifications" would have announced the number of things in the cart.
   */
  navItemLabel(item: NavItem): string {
    const n = item.badgeCount?.() ?? 0;
    if (n <= 0) return item.title;
    const noun = item.badgeNoun ?? 'item';
    return `${item.title}, ${n} ${noun}${n === 1 ? '' : 's'}`;
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
