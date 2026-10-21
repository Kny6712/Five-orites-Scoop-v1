// src/app/core/platform/share.service.ts
// Five-orites Scoop — The only place the app opens the OS share sheet
//
// WHY THIS EXISTS
// Same reason as file.service.ts: CsvExportService used to import the plugin and
// call it inline. The share sheet is the only way a web page can hand a file to
// another app on Android or iOS — there is no "save as" a page can trigger — so
// the code that opens it is load-bearing and deserved one home.
//
// THE file:// FIELD, RECORDED HERE BECAUSE IT READS LIKE A MISTAKE
// The value handed to Share is a `file://` URI from Filesystem.writeFile, and it
// goes in the `url` field — which looks wrong, because a file URI is not a URL.
// It is correct, and the plugin's own typedefinitions say so: `url` is documented
// as "can be http, https or file:// URL". There is no separate `uri` field on
// ShareOptions, so passing `uri` here is not a silent no-op, it is a TypeScript
// error. The field name is a misnomer in the plugin, not in this code.
//
// WHY THERE IS NO WEB IMPLEMENTATION
// Sharing a file in a browser is not a thing: there is no share sheet, and the
// closest equivalent (a download) is not a share and must not be presented as
// one. Every caller therefore gates on NativeService.isNative() BEFORE reaching
// this service. There is deliberately no `isNative()` branch in here — if this
// class ever grows one, it has stopped being a platform wrapper and started
// being a second CsvExportService.
//
// NOT YET USED: ShareOptions also has a `files?: string[]` field for sharing
// several attachments at once (plugin 4.1.0+). Nothing here needs it yet. Do not
// reach for it when adding a second export format — two attachments to one share
// sheet is a different decision from one file to one share sheet, and it changes
// what the admin sees.

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ShareService {
  /**
   * Opens the platform share sheet with `uri` attached, and resolves once the
   * user has finished with it.
   *
   * TIMING, VERIFIED ON AN ANDROID 13 EMULATOR. This does not resolve when the
   * sheet opens; it resolves when the user dismisses it, completes it, or
   * backgrounds the app. A caller that `await`s this stays pending for as long
   * as the sheet is open, which is why the admin pages show their success toast
   * after the share rather than before it. Do not "optimise" this into a
   * fire-and-forget: that toast's timing depends on this promise.
   *
   * DYNAMIC IMPORT, for the reason in file.service.ts: every caller is already
   * native-gated, so a static import would add a native-only plugin to every
   * browser session's download for a path no browser can reach.
   */
  async shareFile(uri: string, title: string, dialogTitle?: string): Promise<void> {
    const { Share } = await import('@capacitor/share');

    await Share.share({
      title,
      // `url`, despite the value being a file:// URI — see the note at the top
      // of this file. The plugin documents this field as accepting file:// URLs.
      url: uri,
      dialogTitle: dialogTitle ?? title,
    });
  }
}
