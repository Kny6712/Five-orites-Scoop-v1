// src/app/app.routes.ts
// Five-orites Scoop — Root Route Definitions
// Author: Five-orites Scoop team (see README)

import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard, capabilityGuard, teamGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'products',
    loadComponent: () => import('./features/products/products.page').then((m) => m.ProductsPage),
    canActivate: [authGuard],
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./features/products/product-detail/product-detail.page').then(
        (m) => m.ProductDetailPage,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'cart',
    loadComponent: () => import('./features/cart/cart.page').then((m) => m.CartPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders',
    loadComponent: () => import('./features/orders/orders.page').then((m) => m.OrdersPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders/:id',
    loadComponent: () =>
      import('./features/orders/order-tracker/order-tracker.page').then((m) => m.OrderTrackerPage),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    // The in-app notification feed. Behind authGuard because it is derived
    // entirely from the signed-in user's own orders, so there is nothing to show
    // a guest and no document a guest could read.
    path: 'notifications',
    loadComponent: () =>
      import('./features/notifications/notifications.page').then((m) => m.NotificationsPage),
    canActivate: [authGuard],
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about.page').then((m) => m.AboutPage),
  },
  {
    path: 'developers',
    loadComponent: () =>
      import('./features/developers/developers.page').then((m) => m.DevelopersPage),
  },
  {
    path: 'auth',
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    children: [
      {
        path: 'inventory',
        canActivate: [capabilityGuard('manage_inventory')],
        loadComponent: () =>
          import('./admin/inventory/inventory.page').then((m) => m.InventoryPage),
      },
      {
        path: 'orders',
        canActivate: [capabilityGuard('manage_orders')],
        loadComponent: () =>
          import('./admin/orders/admin-orders.page').then((m) => m.AdminOrdersPage),
      },
      {
        path: 'reviews',
        canActivate: [capabilityGuard('moderate_reviews')],
        loadComponent: () =>
          import('./admin/reviews/admin-reviews.page').then((m) => m.AdminReviewsPage),
      },
      {
        path: 'settings',
        canActivate: [capabilityGuard('manage_settings')],
        loadComponent: () =>
          import('./admin/settings/admin-settings.page').then((m) => m.AdminSettingsPage),
      },
      {
        path: 'analytics',
        canActivate: [capabilityGuard('view_analytics')],
        loadComponent: () =>
          import('./admin/analytics/analytics.page').then((m) => m.AnalyticsPage),
      },
      {
        path: 'vouchers',
        canActivate: [capabilityGuard('manage_vouchers')],
        loadComponent: () =>
          import('./admin/vouchers/admin-vouchers.page').then((m) => m.AdminVouchersPage),
      },
      {
        path: 'users',
        canActivate: [capabilityGuard('manage_users')],
        loadComponent: () => import('./admin/users/admin-users.page').then((m) => m.AdminUsersPage),
      },
      {
        path: 'tracking',
        canActivate: [capabilityGuard('manage_orders')],
        loadComponent: () =>
          import('./admin/tracking/admin-tracking.page').then((m) => m.AdminTrackingPage),
      },
      {
        // Manager and owner, NOT admin — `teamGuard` rather than a capabilityGuard,
        // and the reasoning is in admin.guard.ts. Editing the public credits is the
        // one page where the distinction between manager and admin matters.
        path: 'developers',
        canActivate: [teamGuard()],
        loadComponent: () =>
          import('./admin/developers/admin-developers.page').then((m) => m.AdminDevelopersPage),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
