// src/app/shared/components/scoop-map/scoop-map.component.ts
// Five-orites Scoop — OpenStreetMap / Leaflet map
//
// ONE component for both the customer tracker and the admin map. Leaflet's
// lifecycle is easy to get subtly wrong — it needs a container with a non-zero
// height, it must be re-measured after Ionic finishes a page transition, and it
// holds a WebGL-free but non-trivial amount of DOM that must be torn down by hand
// — so duplicating it across two pages is how you end up with a grey square on
// mobile and a memory leak on every route change.
//
// ── Why `await import(...)` ────────────────────────────────────────────────
// A static `import * as L from 'leaflet'` puts Leaflet in the ROUTE's static chunk
// graph. `AdminAwarePreloadingStrategy` in app.config.ts eagerly preloads every
// non-admin lazy chunk after the first navigation, so a static import would ship
// ~145kb of mapping code to every customer whether or not they ever open the
// tracker. A dynamic import inside ngAfterViewInit forces Leaflet into its own
// chunk that is fetched only when a map is actually rendered.
//
// It also points at the ESM build rather than the package root, because Leaflet
// declares no `module` field and the root specifier therefore resolves to a
// CommonJS/UMD build that cannot be tree-shaken.
//
// ── Why the map initialises on ionViewDidEnter ───────────────────────────────
// Inside an <ion-content>, the container has zero height on first paint, and
// Leaflet computes its layout from that. Initialising earlier produces a map that
// renders as a few stacked tiles in the corner until something forces a relayout.
// Waiting for the view to be visible means the container has real dimensions.

import {
  Component,
  ElementRef,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonSpinner } from '@ionic/angular/standalone';
import { AppIconComponent } from '../app-icon/app-icon.component';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Short label shown in the popup, e.g. "#A1B2C3". */
  label: string;
  /** Optional second line. */
  detail?: string;
  /** Marker colour token: one of the brand hues. */
  tone?: 'primary' | 'mint' | 'sunny' | 'danger';
  /** When set, tapping this marker emits `markerTapped`. */
  tappable?: boolean;
}

export interface MapRoute {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

// A minimal structural type for the bits of Leaflet this component touches.
// Declared locally rather than importing the namespace type, so the dynamic
// import stays dynamic — a type-only import is erased at compile time and costs
// nothing, whereas a value import would drag Leaflet into this chunk.
interface LeafletBounds {
  pad(ratio: number): { getCenter(): { lat: number; lng: number } };
}
interface LeafletMarker {
  addTo(map: unknown): LeafletMarker;
  bindPopup(html: string): LeafletMarker;
  setLatLng(latlng: [number, number]): LeafletMarker;
  on(event: string, handler: () => void): LeafletMarker;
  remove(): void;
}
interface LeafletLike {
  map(el: HTMLElement, opts: Record<string, unknown>): any;
  tileLayer(url: string, opts: Record<string, unknown>): { addTo(map: unknown): unknown };
  marker(latlng: [number, number], opts?: Record<string, unknown>): LeafletMarker;
  latLngBounds(points: [number, number][]): LeafletBounds;
  polyline(
    points: [number, number][],
    opts: Record<string, unknown>,
  ): {
    addTo(map: unknown): { remove(): void };
    remove(): void;
  };
  divIcon(opts: Record<string, unknown>): unknown;
}

@Component({
  selector: 'app-scoop-map',
  standalone: true,
  imports: [CommonModule, AppIconComponent, IonSpinner],
  template: `
    <!--
      The height input is bound here rather than through a CSS custom property:
      the stylesheet is a plain string and cannot read an input, and the
      --map-height variable it fell back to was never set by anyone, which is
      why every caller passing a height got the 260px default instead.
      The square class takes precedence, so the admin map does not also get an
      inline height fighting it.
    -->
    <div
      class="map-shell"
      [class.square]="square()"
      [style.height]="square() || !height() ? null : height()"
    >
      <div #mapEl class="map-canvas" [attr.aria-label]="ariaLabel()"></div>

      @if (isLoading()) {
        <div class="map-overlay">
          <ion-spinner name="crescent"></ion-spinner>
          <span>Loading map…</span>
        </div>
      } @else if (hasError()) {
        <!--
          The map is an enhancement, never a gate. If tiles are blocked, the
          network is down, or WebGL/Leaflet failed to load, the customer must
          still be able to see their status timeline and their address — which is
          what this says, rather than showing a dead grey rectangle.
        -->
        <div class="map-overlay error" role="status">
          <app-icon name="wifi-off" />
          <span>The map could not load. Your order status is shown below.</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .map-shell {
        position: relative;
        /* A hard height is required: Leaflet reads the container's box, and an
         auto-height parent collapses to 0 and renders nothing.

         The height input is applied as an inline style on the element in the
         template, not here — this is a plain CSS string, not a template, so it
         cannot carry a binding. It was previously declared and never read: both
         call sites passed a height ("340px" on admin tracking, "240px" on the
         customer tracker) and both maps rendered at the 260px fallback instead. */
        height: var(--map-height, 260px);
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--tile-powder);
      }

      /* The square variant, for the admin map. A delivery map next to a tall
       search panel needs to be square rather than a wide letterbox, or the two
       columns read as unrelated.

       WIDTH carries the constraint and height:auto lets aspect-ratio derive
       the height. This is the fix for a bug that made the square a rectangle:
       the rule used to set width:100% AND an explicit height:min(58vh,520px),
       and with both axes definite aspect-ratio:1/1 is ignored entirely — the
       shell rendered ~1012x468px at 1440x900, about 2.2:1, not square at all.

       Only ONE axis may be definite for aspect-ratio to apply. Sizing the
       width by viewport units keeps it square at any width without a media
       query, and the cap stops it becoming a full-screen square on a large
       monitor. Leaflet still gets a resolved pixel box, because the height is
       computed from the width before paint rather than after layout. */
      .map-shell.square {
        width: min(100%, 58vh, 520px);
        height: auto;
        aspect-ratio: 1 / 1;
        margin-inline: auto;
      }

      @media (min-width: 1024px) {
        .map-shell.square {
          width: min(100%, 52vh, 560px);
        }
      }

      .map-canvas {
        position: absolute;
        inset: 0;
      }

      .map-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-4);
        text-align: center;
        background: var(--tile-powder);
        color: var(--color-ink-soft);
        font-size: 13px;
        font-weight: 600;
      }

      .map-overlay.error app-icon {
        --icon-size: 30px;
        color: var(--color-sunny-ink);
      }
    `,
  ],
})
export class ScoopMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') private mapEl?: ElementRef<HTMLElement>;

  readonly markers = input<MapMarker[]>([]);
  readonly route = input<MapRoute | null>(null);
  readonly ariaLabel = input<string>('Map');
  /**
   * CSS height for the map shell, e.g. '340px'. Null falls back to 260px.
   *
   * This was dead until now: the input existed and both call sites passed a
   * value, but nothing bound it to the element, so every map silently rendered
   * at the fallback. `square` is the alternative for the admin map.
   */
  readonly height = input<string | null>(null);

  /** Render as a balanced square rather than a letterbox. */
  readonly square = input<boolean>(false);

  readonly markerTapped = output<MapMarker>();

  isLoading = signal(true);
  hasError = signal(false);

  private leaflet: LeafletLike | null = null;
  private mapInstance: any = null;
  private destroyed = false;
  /** Kept so a re-render updates markers instead of stacking duplicates. */
  private drawnMarkers: LeafletMarker[] = [];
  private drawnRoute: { remove(): void } | null = null;

  constructor() {
    // Redraw whenever the inputs change. An effect rather than ngOnChanges,
    // because the markers array is rebuilt by a computed and would otherwise be a
    // new reference on every read.
    effect(() => {
      const markers = this.markers();
      const route = this.route();
      // Read both so the effect re-runs for either.
      void markers;
      void route;
      this.redraw();
    });
  }

  /**
   * Ionic lifecycle hook. Called by name by <ion-content> once the page is
   * actually visible, which is when the map container finally has a real height.
   */
  ionViewDidEnter(): void {
    void this.init();
  }

  /** Fallback for hosts without an Ionic view lifecycle (e.g. a unit test). */
  ngAfterViewInit(): void {
    if (!this.mapInstance) {
      setTimeout(() => {
        if (!this.mapInstance && !this.destroyed) void this.init();
      }, 0);
    }
  }

  private async init(): Promise<void> {
    if (this.mapInstance || this.destroyed) return;
    const el = this.mapEl?.nativeElement;
    if (!el) return;

    try {
      // Deep path to the ESM build, not the package root — see
      // src/types/leaflet-esm.d.ts. The root specifier resolves to UMD because
      // Leaflet declares no `module` field, and a CommonJS module cannot be
      // tree-shaken, so the whole library would land in this chunk.
      //
      // A dynamic import yields the module NAMESPACE, so the actual value sits on
      // `.default`. The `?? mod` fallback covers the case where a bundler unwraps
      // it for us, rather than assuming one interop shape and failing at runtime.
      const mod = await import('leaflet/dist/leaflet-src.esm.js');
      const L = ((mod as { default?: unknown }).default ?? mod) as LeafletLike;
      if (this.destroyed) return;

      this.leaflet = L;
      this.mapInstance = L.map(el, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false, // a wheel must not swallow page scrolling on mobile
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(this.mapInstance);

      this.isLoading.set(false);
      this.redraw();

      // The container may have been laid out after the map was created (fonts,
      // an image above it finishing). invalidateSize() tells Leaflet to re-read
      // it; without this the tile grid is offset inside the box.
      setTimeout(() => this.mapInstance?.invalidateSize?.(), 120);
    } catch (err) {
      console.error('Map failed to initialise', err);
      this.isLoading.set(false);
      this.hasError.set(true);
    }
  }

  private redraw(): void {
    const L = this.leaflet;
    if (!L || !this.mapInstance) return;

    for (const m of this.drawnMarkers) m.remove();
    this.drawnMarkers = [];
    this.drawnRoute?.remove();
    this.drawnRoute = null;

    const route = this.route();
    const points: [number, number][] = [];

    if (route) {
      points.push([route.from.lat, route.from.lng], [route.to.lat, route.to.lng]);
      this.drawnRoute = L.polyline(points, {
        // The primary INK, not the primary hue. This is a polyline drawn over
        // OpenStreetMap tiles, which are themselves mid-tone greens, greys and
        // blues — a powder-blue route on that background would disappear. The
        // ink at 7.12:1 on white stays visible over any of it. Read from the
        // computed token rather than hardcoded, so it follows a palette change.
        color:
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-primary-ink')
            .trim() || '#1B5E7E',
        weight: 4,
        opacity: 0.85,
        dashArray: '8 8',
      }).addTo(this.mapInstance);
    }

    const markers = this.markers();
    for (const marker of markers) {
      points.push([marker.lat, marker.lng]);
      const m = L.marker([marker.lat, marker.lng], {
        icon: L.divIcon({
          className: 'scoop-pin',
          html: `<span class="scoop-pin-dot tone-${marker.tone ?? 'primary'}"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).addTo(this.mapInstance);

      if (marker.tappable) {
        m.bindPopup(
          `<strong>${escapeHtml(marker.label)}</strong>` +
            (marker.detail ? `<br>${escapeHtml(marker.detail)}` : ''),
        );
        m.on('click', () => this.markerTapped.emit(marker));
      }
      this.drawnMarkers.push(m);
    }

    if (points.length === 1) {
      this.mapInstance.setView?.(points[0], 15);
    } else if (points.length > 1) {
      const bounds = L.latLngBounds(points).pad(0.25);
      this.mapInstance.fitBounds?.(bounds, { maxZoom: 16 });
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Leaflet does not clean up after itself. Without remove(), the tile layer,
    // its event listeners and the resize observer all survive the component and
    // leak on every navigation.
    this.mapInstance?.remove?.();
    this.mapInstance = null;
    this.leaflet = null;
    this.drawnMarkers = [];
    this.drawnRoute = null;
  }
}

/** Escapes a string for safe interpolation into a Leaflet popup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
