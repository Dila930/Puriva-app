import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { EducationPage } from './education.page';

@NgModule({
  imports: [
    EducationPage,
    RouterModule.forChild([{ path: '', component: EducationPage }])
  ]
})
export class EducationPageModule {}
