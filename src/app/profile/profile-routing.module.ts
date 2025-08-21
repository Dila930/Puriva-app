import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ProfilePage } from './profile.page';

const routes: Routes = [
  { path: '', component: ProfilePage },
  {
    path: 'settings',
    loadComponent: () => import('./settings/profile-settings.page').then(m => m.ProfileSettingsPage)
  },
  {
    path: 'activity',
    loadComponent: () => import('./activity/profile-activity.page').then(m => m.ProfileActivityPage)
  },
  {
    path: 'help',
    loadComponent: () => import('./help/profile-help.page').then(m => m.ProfileHelpPage)
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProfilePageRoutingModule {}
