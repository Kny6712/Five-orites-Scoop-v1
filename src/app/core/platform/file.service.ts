// src/app/core/platform/file.service.ts
// Five-orites Scoop — The only place the app touches the device filesystem
//
// WHY THIS EXISTS
// CsvExportService used to `await import('@capacitor/filesystem')` and call
// `Filesystem.writeFile` itself. Moving that call here changes no behaviour, but
// it does separate the two things the export actually needs to know:
//
//   - WHICH DIRECTORY and WHICH ENCODING are safe on Android 11+ and iOS. That
//     is a platform fact, and it is the kind of fact that gets re-decided,
//     wrongly, by each caller that needs a file.
//   - WHAT the export is trying to do, which is business logic and belongs to
//     the caller.
//
// Directory.Cache, NOT Directory.Documents
// On Android 11+ the Documents directory is scoped storage: writes there can fail
// outright without a legacy-storage opt-in that this app does not ask for. A
// directory the app writes to and never cleans up is also worse than a cache the
// OS reclaims on its own. So every write here goes to Cache, and the caller is
// responsible for deleting — which is why `deleteCacheFile` exists rather than a
// blanket `clear()`.
//
// THE FILE PROVIDER CONSTRAINT
// A share of a file only resolves if BOTH halves are present: the
// <cache-path name="my_cache_images" path="." /> entry in
// android/app/src/main/res/xml/file_paths.xml, AND the FileProvider declared
// with authority <appId>.fileprovider and grantUriPermissions="true". Capacitor
// core contributes the second; the share plugin's own AAR manifest declares no
// provider, so neither half is sufficient alone. A file written anywhere else —
// a user-picked directory, an external volume — needs its own path entry in
// file_paths.xml or the share downstream fails with no useful diagnostic. That
// is the constraint to respect before adding a method here.

import { Injectable } from '@angular/core';

/** What the platform wrote, and what a share needs to point at. */
export interface WrittenFile {
  /** The `file://` URI the share sheet must be handed. NOT a path. */
  uri: string;
  /** The name as given to `writeCacheFile`, echoed back for delete/matching. */
  filename: string;
}

@Injectable({ providedIn: 'root' })
export class FileService {
  /**
   * Writes `contents` into the app's cache directory as UTF-8.
   *
   * The caller owns the lifetime of what this returns: nothing here schedules a
   * cleanup, because the correct moment to delete is "after the share sheet
   * closes" and this service cannot know when that is. CsvExportService's
   * `finally` block is the right owner of that.
   *
   * DYNAMIC IMPORT, DELIBERATE. Every caller of this method is already gated on
   * running natively, so a static `@capacitor/filesystem` import would buy
   * nothing on a device and would add a native-only plugin to every web session's
   * download for a code path a browser can never reach. This is the exact reason
   * the original inline dynamic import existed; it is preserved here, one layer
   * down, where it now also has a comment explaining itself.
   */
  async writeCacheFile(filename: string, contents: string): Promise<WrittenFile> {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');

    const written = await Filesystem.writeFile({
      path: filename,
      data: contents,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    return { uri: written.uri, filename };
  }

  /**
   * Removes a file written by `writeCacheFile`. Best-effort: never throws.
   *
   * It never throws because it is always called from a cleanup path that is
   * already handling the outcome the caller cares about. An export that
   * succeeded and then failed to tidy up is a success; propagating a cleanup
   * failure would report it as an export failure and make the admin retry a file
   * they already have. A stale cache file is reclaimed by the OS regardless.
   */
  async deleteCacheFile(filename: string): Promise<void> {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.deleteFile({ path: filename, directory: Directory.Cache }).catch(
      () => undefined,
    );
  }
}
