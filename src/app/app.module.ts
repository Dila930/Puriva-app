import { NgModule, inject, CUSTOM_ELEMENTS_SCHEMA, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

// Firebase imports
import { FirebaseApp, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeFirestore, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getDatabase, provideDatabase } from '@angular/fire/database';
import { provideStorage, getStorage } from '@angular/fire/storage';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { environment } from '../environments/environment';

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
    provideAuth(() => {
      const auth = getAuth();
      // Configure auth settings for better popup handling
      if (isDevMode()) {
        // Enable debug mode in development
        (auth as any).settings.appVerificationDisabledForTesting = true;
      }
      return auth;
    }),
    provideDatabase(() => getDatabase()),
    provideStorage(() => getStorage()),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
