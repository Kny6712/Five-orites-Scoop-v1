// src/app/core/services/toast.service.ts
import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(private toastCtrl: ToastController) {}

  async show(
    message: string,
    color: 'primary' | 'success' | 'warning' | 'danger' = 'primary',
    duration = 2500,
  ): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      color,
      position: 'bottom',
      cssClass: 'fos-toast',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }

  success(message: string): Promise<void> {
    return this.show(message, 'success');
  }
  error(message: string): Promise<void> {
    return this.show(message, 'danger');
  }
  info(message: string): Promise<void> {
    return this.show(message, 'primary');
  }
}
