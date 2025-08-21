import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ForumCreatePage } from './forum-create.page';

@NgModule({
  imports: [
    ForumCreatePage,
    RouterModule.forChild([{ path: '', component: ForumCreatePage }])
  ]
})
export class ForumCreatePageModule {}
