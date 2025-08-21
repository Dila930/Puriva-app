import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NotifikasiPage } from './notifikasi.page';

const routes: Routes = [
  {
    path: '',
    component: NotifikasiPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class NotifikasiPageRoutingModule {}
