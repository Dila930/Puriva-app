import { NgModule, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { environment } from '../environments/environment';

import { provideFirebaseApp, initializeApp, FirebaseApp } from '@angular/fire/app';
import { provideFirestore, initializeFirestore } from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideDatabase, getDatabase } from '@angular/fire/database';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule, 
    IonicModule.forRoot(), 
    AppRoutingModule,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Initialize Firebase app first
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // Initialize Firestore using the injected FirebaseApp to guarantee order
    provideFirestore(() => {
      const app = inject(FirebaseApp);
      return initializeFirestore(app, { experimentalAutoDetectLongPolling: true } as any);
    }),
    provideAuth(() => getAuth()),
    provideDatabase(() => getDatabase()),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
