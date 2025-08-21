import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { NewsCreatePage } from './news-create.page';

@NgModule({
  imports: [
    NewsCreatePage,
    RouterModule.forChild([{ path: '', component: NewsCreatePage }])
  ]
})
export class NewsCreatePageModule {}
