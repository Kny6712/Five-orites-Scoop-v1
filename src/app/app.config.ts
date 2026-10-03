// src/app/app.config.ts
// Five-orites Scoop — Angular Application Configuration

import { ApplicationConfig, inject, Injectable } from '@angular/core';
import {
  provideRouter,
  withPreloading,
  PreloadingStrategy,
  Route,
} from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideIonicAngular } from '@ionic/angular/standalone';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { isStaffRole } from './core/models/user.model';
import { environment } from '../environments/environment';

/**
 * The `loadComponent` thunks of every route under an `admin` path segment.
 *
 * The preloader hands the strategy a bare Route with no way to walk UP to a
 * parent, and identity of the route object is not usable either: the router
 * copies every route through standardizeConfig() on init, so the object it
 * passes the strategy is a different object from the one in `routes`. The
 * `loadComponent` arrow function, however, survives that shallow copy BY
 * REFERENCE and is unique per lazy route — so it is the one identifier that
 * both survives and cannot collide.
 *
 * Matching on `path` would not do: the admin pages are children of a bare
 * `admin` parent route and the storefront has its own `orders` route, so
 * `path: 'orders'` is genuinely ambiguous between the two.
 */
function collectAdminLoaders(config: Route[], into: Set<unknown>, underAdmin = false): void {
  for (const route of config) {
    const isAdmin = underAdmin || (route.path ?? '').split('/').includes('admin');
    if (isAdmin && route.loadComponent) into.add(route.loadComponent);
    if (route.children) collectAdminLoaders(route.children, into, isAdmin);
  }
}

/**
 * Preloads every lazy route EXCEPT the admin subtree, unless the signed-in
 * user is an admin.
 *
 * PreloadAllModules downloads all twelve lazy chunks the moment bootstrap
 * settles, admin included. That is a real cost for every customer: the admin
 * inventory, orders and analytics pages are dead weight for the ~100% of
 * sessions that can never open them (adminGuard bounces them), and fetching
 * them largely cancels the point of code splitting in the first place.
 *
 * This fails CLOSED. The router begins preloading after the first
 * NavigationEnd, and the customer's role lives in a Firestore document that
 * resolves asynchronously, so an early preloader pass may see no user at all.
 * Treating "unknown" as "not admin" means a real admin gets their chunks on
 * first visit instead of in the background — a slower first admin page load is
 * a much better failure than shipping admin code to every customer. Because
 * the preloader re-runs on every navigation, an admin who signs in mid-session
 * still gets the admin chunks preloaded on their next navigation.
 */
@Injectable({ providedIn: 'root' })
class AdminAwarePreloadingStrategy implements PreloadingStrategy {
  private authService = inject(AuthService);
  private adminLoaders = new Set<unknown>();

  constructor() {
    collectAdminLoaders(routes, this.adminLoaders);
  }

  preload(route: Route, fn: () => Observable<unknown>): Observable<unknown> {
    if (this.isAdminRoute(route) && !this.isAdminUser()) return of(null);
    return fn().pipe(catchError(() => of(null)));
  }

  /** Unresolved user counts as "not an admin" — see the class comment. */
  private isAdminUser(): boolean {
    try {
      return isStaffRole(this.authService.currentUserSnapshot?.role);
    } catch {
      // AuthService not resolvable from this injector, or Firebase config
      // missing. Skip the preload rather than guess.
      return false;
    }
  }

  private isAdminRoute(route: Route): boolean {
    if (route.loadComponent && this.adminLoaders.has(route.loadComponent)) return true;
    // Fallback for a config this set never saw (runtime resetConfig, or a
    // loadChildren subtree resolved after boot). It errs towards preloading
    // rather than skipping, so a route the strategy cannot recognise still
    // loads — just eagerly, which is the old behaviour and never a data leak.
    return (route.path ?? '').split('/').includes('admin');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withPreloading(AdminAwarePreloadingStrategy)),
    provideHttpClient(),
    provideIonicAngular({
      mode: 'md',
      animated: true,
      backButtonText: '',
    }),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideFirestore(() => getFirestore()),
    provideAuth(() => getAuth()),
  ],
};
