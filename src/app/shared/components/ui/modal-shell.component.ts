// src/app/shared/components/ui/modal-shell.component.ts
import { Component, input, output } from '@angular/core';
import { IonButton, IonButtons, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';
import { AppIconComponent } from '@shared/components/ui/app-icon.component';

@Component({
  selector: 'app-modal-shell',
  standalone: true,
  imports: [IonButton, IonButtons, IonHeader, IonTitle, IonToolbar, AppIconComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title() }}</ion-title>
        @if (closable()) {
          <ion-buttons slot="end">
            <ion-button (click)="close.emit()" aria-label="Close">
              <app-icon name="circle-x" />
            </ion-button>
          </ion-buttons>
        }
      </ion-toolbar>
    </ion-header>
    <div class="modal-body"><ng-content select="[body]" /></div>
    <div class="modal-footer"><ng-content select="[footer]" /></div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .modal-body {
        padding: var(--space-4);
      }
      .modal-footer {
        padding: var(--space-3) var(--space-4);
        border-top: 1px solid var(--ion-color-light);
        display: flex;
        justify-content: flex-end;
        gap: var(--space-2);
      }
    `,
  ],
})
export class ModalShellComponent {
  readonly title = input.required<string>();
  readonly closable = input<boolean>(true);
  readonly close = output<void>();
}
