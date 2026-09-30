// src/app/app.routes.ts
// Five-orites Scoop — Root Route Definitions
// Author: Five-orites Scoop team (see README)

import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
    canActivate: [authGuard],
  },
  {
    path: 'products',
    loadComponent: () =>
      import('./features/products/products.page').then((m) => m.ProductsPage),
    canActivate: [authGuard],
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./features/products/product-detail/product-detail.page').then(
        (m) => m.ProductDetailPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'cart',
    loadComponent: () =>
      import('./features/cart/cart.page').then((m) => m.CartPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders',
    loadComponent: () =>
      import('./features/orders/orders.page').then((m) => m.OrdersPage),
    canActivate: [authGuard],
  },
  {
    path: 'orders/:id',
    loadComponent: () =>
      import('./features/orders/order-tracker/order-tracker.page').then(
        (m) => m.OrderTrackerPage
      ),
    canActivate: [authGuard],
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./features/profile/profile.page').then((m) => m.ProfilePage),
    canActivate: [authGuard],
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./features/about/about.page').then((m) => m.AboutPage),
  },
  {
    path: 'developers',
    loadComponent: () =>
      import('./features/developers/developers.page').then(
        (m) => m.DevelopersPage
      ),
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./features/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    children: [
      {
        path: 'inventory',
        loadComponent: () =>
          import('./admin/inventory/inventory.page').then(
            (m) => m.InventoryPage
          ),
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./admin/orders/admin-orders.page').then(
            (m) => m.AdminOrdersPage
          ),
      },
      {
        path: 'analytics',
        loadComponent: () =>
          import('./admin/analytics/analytics.page').then(
            (m) => m.AnalyticsPage
          ),
      },
      {
        path: 'vouchers',
        loadComponent: () =>
          import('./admin/vouchers/admin-vouchers.page').then(
            (m) => m.AdminVouchersPage
          ),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./admin/users/admin-users.page').then(
            (m) => m.AdminUsersPage
          ),
      },
      {
        path: 'tracking',
        loadComponent: () =>
          import('./admin/tracking/admin-tracking.page').then(
            (m) => m.AdminTrackingPage
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
