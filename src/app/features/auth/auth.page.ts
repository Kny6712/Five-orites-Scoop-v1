// src/app/features/auth/auth.page.ts
// Five-orites Scoop — Login / Register / Admin Register Page

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  IonLabel,
} from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';
import { AppFooterComponent } from '@shared/components/commerce/app-footer.component';
import { AlertBannerComponent } from '@shared/components/ui/alert-banner.component';
import { AuthService } from '@core/services/identity/auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonText,
    IonSpinner,
    IonLabel,
    AppIconComponent,
    AlertBannerComponent,
    AppFooterComponent,
  ],
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
})
export class AuthPage {
  private authService = inject(AuthService);
  private router = inject(Router);

  mode = signal<AuthMode>('login');
  email = '';
  password = '';
  displayName = '';
  showPassword = signal(false);
  isLoading = signal(false);
  errorMessage = signal('');
  /** Non-empty after a reset request. Wording never reveals account existence. */
  resetMessage = signal('');
  isSendingReset = signal(false);

  constructor() {
    this.authService.currentUser$
      .pipe(
        takeUntilDestroyed(),
        filter((user) => user !== null),
      )
      .subscribe(() => this.router.navigate(['/dashboard']));
  }

  setMode(mode: AuthMode): void {
    this.mode.set(mode);
    this.errorMessage.set('');
    this.resetMessage.set('');
  }

  togglePasswordVisibility(): void {
    this.showPassword.set(!this.showPassword());
  }

  async submit(): Promise<void> {
    this.errorMessage.set('');
    this.isLoading.set(true);

    try {
      if (this.mode() === 'login') {
        await this.authService.signInWithEmail(this.email, this.password);
      } else {
        if (!this.displayName.trim()) {
          this.errorMessage.set('Please enter your full name.');
          return;
        }
        await this.authService.registerWithEmail(this.email, this.password, this.displayName);
      }

      await this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      this.errorMessage.set(this.parseFirebaseError(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Sends a reset email.
   *
   * The confirmation is intentionally the SAME whether or not an account exists
   * for that address. Reporting "no account" here would be an account-enumeration
   * hole, identical in shape to the one the login error messages had.
   */
  async sendResetEmail(): Promise<void> {
    this.errorMessage.set('');
    this.resetMessage.set('');
    if (!this.email.trim()) {
      this.errorMessage.set('Enter your email address first.');
      return;
    }
    this.isSendingReset.set(true);
    try {
      await this.authService.sendPasswordResetEmail(this.email);
      this.resetMessage.set(
        'If an account exists for that address, a reset link is on its way. Check your spam folder if it does not arrive.',
      );
    } catch {
      this.errorMessage.set('Could not send the reset email. Please try again later.');
    } finally {
      this.isSendingReset.set(false);
    }
  }

  async signInWithGoogle(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    console.log('[Auth] Google button pressed');
    try {
      await this.authService.signInWithGoogle();
      console.log('[Auth] navigating to /dashboard');
      await this.router.navigate(['/dashboard']);
    } catch (err: unknown) {
      if (this.isGoogleSignInCancelled(err)) return;
      this.errorMessage.set(this.parseFirebaseError(err));
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Was this a deliberate cancellation rather than a failure?
   *
   * Native: the plugin rejects with `12501` (ApiException
   * SIGN_IN_CANCELLED), message "The user canceled the sign-in flow."
   * Browser: Firebase throws `auth/popup-closed-by-user` /
   * `auth/user-cancelled` when the popup is dismissed. Only the native code
   * and the word "cancel" were matched before, so closing the popup showed a
   * red banner with a raw SDK string in it — a cancellation is not an error
   * and should leave the page quiet.
   */
  private isGoogleSignInCancelled(err: unknown): boolean {
    const e = (err ?? {}) as { code?: unknown; message?: unknown };
    const code = String(e.code ?? '');
    if (code === '12501') return true;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/user-cancelled') return true;
    const message =
      typeof e.message === 'string' ? e.message : err instanceof Error ? err.message : '';
    return /cancel/i.test(message);
  }

  /**
   * Turns an SDK/plugin error into a sentence a shopper can act on.
   *
   * The native Google plugin rejects with `call.reject("Something went
   * wrong", "" + statusCode)`, so the useful half — the Google ApiException
   * status code — arrives as `err.code` ("10", "12500", "7") while the
   * message is a fixed string. This mapping was `auth/*` only, so every
   * native failure fell through to that fixed string and the actual cause was
   * never logged or shown. Both halves are logged now, once, without tokens.
   */
  private parseFirebaseError(err: unknown): string {
    const e = (err ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : '';
    const fallbackMessage =
      typeof e.message === 'string' ? e.message : err instanceof Error ? err.message : '';
    // Deliberately ONE message for every credential failure. Telling a
    // visitor "no account found with this email" but "incorrect password"
    // for the same input turns the login form into an account-enumeration
    // oracle. These two codes are what the SDK throws when Email Enumeration
    // Protection is OFF; with it on it throws invalid-credential instead.
    // One message is correct in both configurations.
    const messages: Record<string, string> = {
      'auth/user-not-found': 'Incorrect email or password.',
      'auth/wrong-password': 'Incorrect email or password.',
      'auth/invalid-credential': 'Incorrect email or password.',
      'auth/email-already-in-use': 'An account with this email already exists.',
      'auth/weak-password': 'Password must be at least 6 characters.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      // Google ApiException status codes, surfaced by the native plugin as
      // `err.code`. 10 = DEVELOPER_ERROR (client ID / audience / SHA-1
      // mismatch), 12500 = SIGN_IN_FAILED (the general Google failure),
      // 7 = NETWORK_ERROR. 12501 (cancelled) never reaches here — it is
      // filtered by isGoogleSignInCancelled().
      '10': GOOGLE_SIGN_IN_PROBLEM,
      '12500': GOOGLE_SIGN_IN_PROBLEM,
      '7': 'Could not reach Google. Check your connection and try again.',
      // Firebase's own code for the same class of failure, on the browser path.
      'auth/network-request-failed':
        'Could not reach the server. Check your connection and try again.',
    };
    if (code) {
      // One line per failure: code + message only. No ID tokens, no cookies,
      // no credentials — the plugin's message is a fixed string and this is
      // the only place the previously-swallowed status code becomes visible.
      console.warn(`[Auth] sign-in failed (code=${code}): ${fallbackMessage || '(no message)'}`);
    }
    if (code && messages[code]) return messages[code];
    return fallbackMessage || 'An unexpected error occurred.';
  }
}

/**
 * Shown for every Google-side refusal whose specific cause we cannot name.
 *
 * Deliberately generic: it must be safe for code 10 (a build/config fault the
 * user cannot fix) and code 12500 (anything Google declined). Naming a cause
 * we have not verified would be worse than saying nothing.
 */
const GOOGLE_SIGN_IN_PROBLEM =
  'Google sign-in could not be completed. Please try again, or sign in with your email instead.';
