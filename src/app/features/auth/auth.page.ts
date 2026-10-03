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
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AppFooterComponent } from '../../shared/components/app-footer/app-footer.component';
import { AlertBannerComponent } from '../../shared/components/alert-banner/alert-banner.component';
import { AuthService } from '../../core/services/auth.service';
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
    try {
      await this.authService.signInWithGoogle();
      await this.router.navigate(['/dashboard']);
    } catch {
      this.errorMessage.set('Google sign-in failed. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private parseFirebaseError(err: unknown): string {
    if (err instanceof Error) {
      const code = (err as { code?: string }).code ?? '';
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
      };
      return messages[code] ?? err.message ?? 'An unexpected error occurred.';
    }
    return 'An unexpected error occurred.';
  }
}
