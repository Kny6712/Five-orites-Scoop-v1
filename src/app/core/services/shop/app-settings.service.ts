// src/app/core/services/shop/app-settings.service.ts
// Five-orites Scoop — App-wide display preferences
//
// WHY THESE THREE AND NOT A TEXT-SIZE CONTROL
// A text-size setting is the obvious thing to reach for and it does not work
// here without a separate pass: roughly 60% of font sizes in this app are
// hardcoded pixel values inside per-component stylesheets rather than reading a
// token, so scaling a root font variable would silently do nothing to most of
// the screen. Shipping a knob that appears to work and does not is worse than
// not shipping it, so the control is deliberately absent and noted here instead.
//
// What IS included works app-wide for a real reason, because all three are
// expressed in the same three places — a token block, one global selector, and
// the document element — rather than in thirty stylesheets:
//
//   reduceMotion  -> html[data-motion='reduced'] in variables.scss
//   highContrast  -> html[data-contrast='high'] in variables.scss
//   notifications -> Firestore, via OrderNotificationService
//
// State is persisted to localStorage rather than Firestore for the two display
// preferences: they are per-device, they must apply before the first paint so a
// motion-sensitive user never sees the animation they asked to skip, and writing
// them to a shared profile would apply this phone's text size to every device.

import { Injectable, computed, effect, signal } from '@angular/core';

const MOTION_KEY = 'five_orites_motion';
const CONTRAST_KEY = 'five_orites_contrast';
const THEME_KEY = 'five_orites_theme';

export type ThemeMode = 'light' | 'dark' | 'system';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    // Private browsing modes throw on localStorage access. Defaulting to "off"
    // (i.e. leave the app alone) is the safe direction: a failed read must not
    // silently enable reduce-motion for a user who did not ask for it.
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'on');
    else localStorage.removeItem(key);
  } catch {
    // Preference simply will not survive a reload. Not worth interrupting for.
  }
}

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  private readonly motionOn = signal(readFlag(MOTION_KEY));
  private readonly contrastOn = signal(readFlag(CONTRAST_KEY));
  private readonly themeModeOn = signal<ThemeMode>(readTheme());
  private readonly systemDarkOn = signal<boolean>(
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false,
  );

  readonly reduceMotion = this.motionOn.asReadonly();
  readonly highContrast = this.contrastOn.asReadonly();
  readonly themeMode = this.themeModeOn.asReadonly();

  readonly effectiveTheme = computed<'light' | 'dark'>(() => {
    const mode = this.themeModeOn();
    if (mode === 'light') return 'light';
    if (mode === 'dark') return 'dark';
    return this.systemDarkOn() ? 'dark' : 'light';
  });

  /**
   * What the user has actually chosen, for display in Settings.
   *
   * The two can disagree: someone with `prefers-reduced-motion: reduce` set at
   * the OS level who has never opened this app has motion already suppressed by
   * CSS while both of these read false. Showing "Off" there would be a lie.
   */
  readonly effectiveReduceMotion = computed(
    () => this.motionOn() || this.systemPrefersReducedMotion(),
  );

  private readonly mql =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  private readonly darkMql =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

  constructor() {
    // The document element is the mechanism both selectors key off, so writing
    // the attribute is the whole implementation — there is no component tree to
    // update and no stylesheet to swap.
    effect(() => {
      const el = document.documentElement;
      if (this.effectiveReduceMotion()) el.setAttribute('data-motion', 'reduced');
      else el.removeAttribute('data-motion');
    });

    effect(() => {
      const el = document.documentElement;
      if (this.contrastOn()) el.setAttribute('data-contrast', 'high');
      else el.removeAttribute('data-contrast');
    });

    effect(() => {
      const el = document.documentElement;
      const theme = this.effectiveTheme();
      el.setAttribute('data-theme', theme);
    });

    // Keep system-dark in sync when OS preference changes.
    this.darkMql?.addEventListener('change', (e) => this.systemDarkOn.set(e.matches));
  }

  private systemPrefersReducedMotion(): boolean {
    return this.mql?.matches ?? false;
  }

  setReduceMotion(on: boolean): void {
    this.motionOn.set(on);
    writeFlag(MOTION_KEY, on);
  }

  setHighContrast(on: boolean): void {
    this.contrastOn.set(on);
    writeFlag(CONTRAST_KEY, on);
  }

  setTheme(mode: ThemeMode): void {
    this.themeModeOn.set(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // ignore
    }
  }
}
