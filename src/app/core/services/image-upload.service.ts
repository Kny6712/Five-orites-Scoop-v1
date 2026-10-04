// src/app/core/services/image-upload.service.ts
// Five-orites Scoop — Product image upload via Cloudinary (unsigned preset, no secret in app)

import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

// Uploads are downscaled client-side first to keep them fast and small.
// This is also the ceiling for delivery: the CloudinaryPipe never asks for
// more than this, so no request is ever upscaled from a smaller source.
const MAX_SIDE_PX = 1024;

const FOLDER = 'five-orites-scoop/products';
const AVATAR_FOLDER = 'five-orites-scoop/avatars';

/**
 * Longest side of a stored avatar.
 *
 * Half the product ceiling on purpose: `buildCloudinaryUrl` never upscales and
 * caps delivery at the requested width, and the avatar is drawn in a circle
 * around 96px. A 1024px source is ~4x the bytes for no visible gain.
 */
const AVATAR_MAX_PX = 512;

function readAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

function downscale(img: HTMLImageElement): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(img.width, img.height));
  const w = Math.max(Math.round(img.width * scale), 1);
  const h = Math.max(Math.round(img.height * scale), 1);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not supported on this device.');
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/jpeg',
      0.85,
    );
  });
}

/**
 * Cloudinary returns a specific, actionable message for bad presets, so pass
 * it through rather than hiding it behind a generic failure. The preset is
 * the most common misconfiguration (wrong name, or left set to Signed).
 */
function describeUploadError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('unsigned') || m.includes('preset')) {
    return `Upload preset rejected the file (${message}). Check the preset name and that Signing Mode is Unsigned.`;
  }
  if (m.includes('unauthorized') || m.includes('not allowed')) {
    return `Cloudinary refused the upload (${message}).`;
  }
  if (m.includes('file size') || m.includes('too large')) {
    return `That image is too large (${message}). Try a smaller photo.`;
  }
  if (m.includes('format')) {
    return `That file type is not allowed by the upload preset (${message}).`;
  }
  return `Image upload failed: ${message}`;
}

/**
 * Centre-crops to a square and re-encodes.
 *
 * `downscale()` preserves aspect ratio, which is right for a product shot and
 * wrong for an avatar: a 3:2 portrait becomes a letterboxed strip inside a
 * circular frame. Cropping from the centre is the only defensible default
 * without a face detector — the subject is not reliably in the middle, but it is
 * at least never cropped away entirely, which edge-anchoring risks doing.
 *
 * Never upscales: a source smaller than the target is emitted as-is.
 */
function cropSquare(img: HTMLImageElement, maxPx: number): Promise<Blob> {
  const side = Math.min(img.width, img.height);
  const scale = Math.min(1, maxPx / side);
  const w = Math.max(1, Math.round(side * scale));
  const sx = Math.round((img.width - side) / 2);
  const sy = Math.round((img.height - side) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = w;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image processing is not supported on this device.');
  ctx.drawImage(img, sx, sy, side, side, 0, 0, w, w);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/jpeg',
      0.85,
    );
  });
}

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  get isConfigured(): boolean {
    const c = environment.cloudinary;
    return !!c && !!c.cloudName && !!c.uploadPreset;
  }

  /**
   * Uploads a device image to Cloudinary and returns its HTTPS URL.
   *
   * The returned URL is stored untransformed. Sizing is applied at render time
   * by the CloudinaryPipe, so one stored file serves every screen size.
   */
  async uploadProductImage(file: File): Promise<string> {
    this.assertConfigured();
    this.assertIsImage(file);

    const blob = await downscale(await readAsImage(file));
    return this.post(blob, FOLDER, 'product.jpg');
  }

  /**
   * Uploads a PROFILE AVATAR and returns its HTTPS URL.
   *
   * Deliberately a sibling method rather than a parameterised refactor of
   * uploadProductImage. Both existing call sites are admin product flows, and
   * keeping that method's behaviour byte-identical means this addition cannot
   * break stock photography. The shared parts (assertConfigured, assertIsImage,
   * post) are factored out; the two entry points differ only in folder, filename
   * and geometry.
   *
   * Two things are different from a product image:
   *
   *  - It is CROPPED SQUARE. `downscale()` preserves aspect ratio and has no crop
   *    step, so a 3:2 photo uploaded as an avatar renders as a letterboxed strip
   *    inside the circular frame. `cropSquare()` draws the centred sub-rect, and
   *    centring is the only defensible default for an arbitrary portrait — face
   *    position is unknowable without a face detector.
   *
   *  - It is capped at 512px, not 1024. `buildCloudinaryUrl` caps render width at
   *    whatever the caller asks for and never upscales, so a 1024px avatar is
   *    roughly four times the bytes for no visible gain in a 96px circle.
   *
   * NOTE: `folder` is a per-request parameter, so this depends on the unsigned
   * preset NOT having "Restrict folder" enabled in the Cloudinary console. If
   * avatars start failing while product images succeed, that setting is why.
   */
  async uploadAvatar(file: File): Promise<string> {
    this.assertConfigured();
    this.assertIsImage(file);

    const square = await cropSquare(await readAsImage(file), AVATAR_MAX_PX);
    return this.post(square, AVATAR_FOLDER, 'avatar.jpg');
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new Error(
        'Cloudinary is not configured. Ask your admin to add the cloud name + upload preset.',
      );
    }
  }

  private assertIsImage(file: File): void {
    if (!file.type.startsWith('image/')) {
      throw new Error('Please choose an image file.');
    }
  }

  /** Shared POST. `blob` is already re-encoded, so this never sees a raw File. */
  private async post(blob: Blob, folder: string, filename: string): Promise<string> {
    const c = environment.cloudinary;
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('upload_preset', c.uploadPreset);
    form.append('folder', folder);

    let res: Response;
    try {
      res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/upload`, {
        method: 'POST',
        body: form,
      });
    } catch {
      throw new Error('Upload failed. Check your internet connection and try again.');
    }

    const json = (await res.json()) as { secure_url?: string; error?: { message?: string } };
    if (!res.ok || !json.secure_url) {
      throw new Error(describeUploadError(json.error?.message ?? `HTTP ${res.status}`));
    }
    return json.secure_url;
  }
}
