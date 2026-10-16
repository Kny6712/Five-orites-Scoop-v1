// src/app/shared/pipes/cloudinary.pipe.ts
// Five-orites Scoop — On-the-fly image resizing for Cloudinary URLs
// Author: Five-orites Scoop team (see README)
//
// Thin Angular wrapper around buildCloudinaryUrl(); see
// src/app/core/logic/image-url.ts for the logic and its tests.

import { Pipe, PipeTransform } from '@angular/core';
import { buildCloudinaryUrl } from '@core/logic/image-url';

@Pipe({
  name: 'cloudinary',
  standalone: true,
})
export class CloudinaryPipe implements PipeTransform {
  transform(value: string | null | undefined, width: number): string {
    return buildCloudinaryUrl(value, width);
  }
}
