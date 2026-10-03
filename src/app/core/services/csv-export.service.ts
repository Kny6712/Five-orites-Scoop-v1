// src/app/core/services/csv-export.service.ts
// Five-orites Scoop — One CSV export path for web and native
//
// WHY THIS EXISTS
// Every admin export went through `downloadCsv` in core/logic/csv.ts, which
// builds a Blob, makes an object URL and clicks a synthetic <a download>. On the
// web that is correct. Inside a Capacitor WebView it does nothing at all: there
// is no download manager behind the anchor, no filesystem permission model the
// browser path knows about, and the click resolves to nothing. The export
// appeared to succeed — the button ran, no error surfaced — and the admin got no
// file. Six call sites (analytics, orders, reviews, stock movements,
// reconciliation, vouchers) plus the product template all had this shape.
//
// csv.ts is deliberately left alone: it is framework-free so `test:logic` can
// import it without touching the DOM, and that is worth more than one fewer file.
// This service is the layer that knows which platform it is on.
//
// WHY THE NATIVE PATH IS WRITE-THEN-SHARE
// There is no "save as" on Android or iOS that a web page can trigger. The
// portable approach is the one the platform actually offers: write the file into
// the app's own cache, then hand it to the share sheet, where the admin picks
// Drive, Files, email, or a messaging app. That is also what they want — an
// export they can send to their accountant is more useful than one that lands in
// a folder they have to go and find.
//
// Directory.Cache, NOT Directory.Documents: on Android 11+ Documents is scoped
// and writes there can fail outright without a legacy-storage opt-in, and a
// exports directory the app never cleans up is worse than a cache the OS
// reclaims. The file is deleted immediately after the share sheet returns.
//
// ANDROID FILE PROVIDER
// @capacitor/share serves files from the app's own cache directory through a
// FileProvider the plugin contributes, which covers this path. A file from
// anywhere else — a user-picked directory, an external volume — needs a
// FileProvider configured in AndroidManifest.xml and will throw "no such file"
// or a bare Uri permission failure at the share call. If a future export writes
// somewhere else, that is the thing to add, and it cannot be verified until
// there is an android/ folder to edit.

import { Injectable, inject } from '@angular/core';
import { Platform } from '@ionic/angular/standalone';

/** Outcome of one export, so callers can tell success from a silent no-op. */
export type CsvExportResult =
  | { ok: true; via: 'download' | 'share' }
  | { ok: false; via: 'download' | 'share'; error: string };

@Injectable({ providedIn: 'root' })
export class CsvExportService {
  private platform = inject(Platform);

  /**
   * Hands a CSV to the admin, by whichever route the platform actually has.
   *
   * Returns a result rather than throwing, because the web path can genuinely
   * fail in ways a caller may want to surface (a blocked popup, a revoked
   * permission) and "nothing happened" is the failure mode worth reporting.
   */
  async export(csv: string, filename: string): Promise<CsvExportResult> {
    return this.platform.is('capacitor')
      ? this.exportNative(csv, filename)
      : this.exportWeb(csv, filename);
  }

  /**
   * The UTF-8 BOM every export should carry.
   *
   * Excel on Windows assumes the system ANSI codepage for a .csv unless a BOM
   * says otherwise, so without this the peso sign and every accented flavor name
   * arrive as mojibake. The web path never had one — an export that is correct in
   * a browser can still be unreadable in the program the admin opens it in.
   *
   * Only on the native path, because that is where the file is handed to an
   * external app that will sniff it. Web downloads are opened by a browser that
   * has already been told the charset by the Blob type.
   */
  private static readonly BOM = '\uFEFF';

  private async exportNative(csv: string, filename: string): Promise<CsvExportResult> {
    // Dynamic imports: both plugins are native-only, and a static import would pull
    // them into the web bundle where they can never work. Same pattern as
    // NotificationService's dynamic import of @capacitor/push-notifications.
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');

      // Directory.Cache, and the filename is reused verbatim: the share sheet
      // shows this name, so a mangled one is the admin's only clue about what
      // they just exported.
      const written = await Filesystem.writeFile({
        path: filename,
        data: CsvExportService.BOM + csv,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });

      try {
        await Share.share({
          title: filename,
          // `uri`, not `url`: a filesystem path from writeFile is not a URL, and
          // passing it as `url` produces a share with no attachment.
          url: written.uri,
          dialogTitle: 'Export CSV',
        });
        return { ok: true, via: 'share' };
      } finally {
        // Clean up whether or not the share succeeded. Leaving exports to pile up
        // in the cache is how a long-running admin session fills the device.
        // Best-effort: a failed cleanup is not worth failing the export over,
        // since the admin already has their file.
        await Filesystem.deleteFile({ path: filename, directory: Directory.Cache }).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('CSV export failed on device.', err);
      return { ok: false, via: 'share', error: message };
    }
  }

  private exportWeb(csv: string, filename: string): Promise<CsvExportResult> {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      // Deferred, not immediate: Safari cancels an in-flight download if the
      // object URL disappears in the same tick as the click.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return Promise.resolve({ ok: true, via: 'download' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('CSV export failed in the browser.', err);
      return Promise.resolve({ ok: false, via: 'download', error: message });
    }
  }
}