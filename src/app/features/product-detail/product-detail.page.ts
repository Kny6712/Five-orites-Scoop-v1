// src/app/features/product-detail/product-detail.page.ts
// Five-orites Scoop — the /products/:id deep link
// Author: Five-orites Scoop team (see README)
//
// WHY THIS PAGE IS NOW A HAND-OFF
// The product detail is a DIALOG over the flavours list, not a page of its
// own. A page has to fill whatever window it is given, and this one was a
// photo band the width of the screen, two enormous size cards and a gold
// button 1300px long. A dialog has a size.
//
// So this route no longer renders anything of its own. It hands the id to the
// listing, which opens the quick-view over the grid — which is also exactly
// what a customer clicking a card gets, so the deep link and the click end up
// in the same place.
//
// The route stays because the URL is shareable: a link to a flavour opens that
// flavour.

import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  template: '',
})
export class ProductDetailPage implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      await this.router.navigate(['/products'], { replaceUrl: true });
      return;
    }
    // The listing opens the dialog from the `open` parameter, so the URL
    // carries the flavour while it is open and can be closed without leaving
    // a history entry that reopens it.
    await this.router.navigate(['/products'], {
      queryParams: { open: id },
      replaceUrl: true,
    });
  }
}
