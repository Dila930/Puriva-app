import { Injectable } from '@angular/core';
import { Subject, Observable, BehaviorSubject } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { Database, ref, set, update, runTransaction, onValue, off } from '@angular/fire/database';
import { Firestore, doc, setDoc, updateDoc, increment, serverTimestamp, collection } from '@angular/fire/firestore';

export type SterilizationStatus = 'processing' | 'completed' | 'stopped';

export interface SterilizationEvent {
  id: string;
  food: string | null;
  duration: number; // minutes
  startedAt: number; // epoch ms
  status: SterilizationStatus;
}

@Injectable({ providedIn: 'root' })
export class SterilizationService {
  private eventsSubject = new Subject<SterilizationEvent>();
  public readonly events$: Observable<SterilizationEvent> = this.eventsSubject.asObservable();
  private currentSessionSubject = new BehaviorSubject<SterilizationEvent | null>(null);
  public readonly currentSession$: Observable<SterilizationEvent | null> = this.currentSessionSubject.asObservable();

  constructor(private db: Database, private auth: Auth, private firestore: Firestore) {}

  private foodLabel(food: string | null): string {
    switch (food) {
      case 'nasi': return 'Nasi';
      case 'sayur': return 'Sayuran';
      case 'ayam': return 'Ayam';
      case 'ikan': return 'Ikan';
      case 'daging': return 'Daging';
      case 'buah': return 'Buah';
      default: return 'Lainnya';
    }
  }

  emitStart(id: string, food: string | null, duration: number): void {
    // Require authenticated user to avoid local-only state
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      try { console.warn('emitStart ignored: no authenticated user'); } catch {}
      return;
    }
    const ev: SterilizationEvent = { id, food, duration, startedAt: Date.now(), status: 'processing' };
    this.eventsSubject.next(ev);
    this.currentSessionSubject.next(ev);

    // Persist to Realtime Database per user
    try {
      const base = `users/${uid}`;
      // Active session
      set(ref(this.db, `${base}/activeSession`), ev);
      // Total today (transactional increment)
      runTransaction(ref(this.db, `${base}/stats/totalToday`), (curr: any) => (typeof curr === 'number' ? curr + 1 : 1));
      // Recent activity keyed by session id for easy updates
      set(ref(this.db, `${base}/recentActivities/${id}`), {
        id,
        food: this.foodLabel(food),
        duration,
        at: ev.startedAt,
        status: 'processing',
      });
      // Mirror simplified path: sterilisasi/{uid}
      this.mulaiSterilisasi(uid, this.foodLabel(food), duration);
      // Firestore aggregates: sterilisasi/{uid}
      const aggRef = doc(this.firestore, 'sterilisasi', uid);
      updateDoc(aggRef as any, {
        uid,
        total: increment(1) as any,
        lastFood: this.foodLabel(food),
        lastDuration: duration,
        lastStartedAt: serverTimestamp() as any,
        lastSessionId: id,
        updatedAt: serverTimestamp() as any,
      } as any).catch(async () => {
        // If doc missing, create it
        await setDoc(aggRef as any, {
          uid,
          total: 1,
          lastFood: this.foodLabel(food),
          lastDuration: duration,
          lastStartedAt: serverTimestamp() as any,
          lastSessionId: id,
          createdAt: serverTimestamp() as any,
          updatedAt: serverTimestamp() as any,
        } as any);
      });
      // Firestore per-session log: sterilisasiLogs/{uid}_{sessionId}
      const logId = `${uid}_${id}`;
      const logRef = doc(this.firestore, 'sterilisasiLogs', logId);
      setDoc(logRef as any, {
        id,
        uid,
        food: this.foodLabel(food),
        duration,
        status: 'processing',
        startedAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
      } as any, { merge: true } as any);
    } catch { /* no-op */ }
  }

  emitFinish(id: string, food: string | null, duration: number, status: SterilizationStatus): void {
    // Require authenticated user to avoid local-only state
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      try { console.warn('emitFinish ignored: no authenticated user'); } catch {}
      return;
    }
    const last = this.currentSessionSubject.getValue();
    const startedAt = last && last.id === id ? last.startedAt : Date.now();
    const ev: SterilizationEvent = { id, food, duration, startedAt, status };
    this.eventsSubject.next(ev);
    this.currentSessionSubject.next(ev);

    // Persist update to DB
    try {
      const base = `users/${uid}`;
      // Update status on activeSession, and clear when ends
      update(ref(this.db, `${base}/activeSession`), { status });
      if (status !== 'processing') {
        // Clear active session after a short moment by setting null
        set(ref(this.db, `${base}/activeSession`), null);
      }
      // Update recent activity for this session id
      update(ref(this.db, `${base}/recentActivities/${id}`), {
        status,
        finishedAt: Date.now(),
      });
      // Firestore log update
      const logId = `${uid}_${id}`;
      const logRef = doc(this.firestore, 'sterilisasiLogs', logId);
      updateDoc(logRef as any, {
        status,
        finishedAt: serverTimestamp() as any,
        updatedAt: serverTimestamp() as any,
      } as any).catch(() => {
        // If log not exist (edge), create minimal
        setDoc(logRef as any, {
          id,
          uid,
          food: this.foodLabel(food),
          duration,
          status,
          startedAt: serverTimestamp() as any,
          finishedAt: serverTimestamp() as any,
          updatedAt: serverTimestamp() as any,
        } as any, { merge: true } as any);
      });
      // Firestore aggregate last status
      const aggRef = doc(this.firestore, 'sterilisasi', uid);
      updateDoc(aggRef as any, {
        lastStatus: status,
        updatedAt: serverTimestamp() as any,
      } as any).catch(() => {});
    } catch { /* no-op */ }
  }

  // ====== Simplified compat-style helpers ======
  initUserData(userId: string): Promise<void> {
    const defaultData = { sesi: 0, durasi: 0, makanan: '' } as any;
    return set(ref(this.db, `sterilisasi/${userId}`), defaultData);
  }

  mulaiSterilisasi(userId: string, makanan: string, durasi: number): Promise<void> {
    // Increment sesi atomically and update fields
    const sesiRef = ref(this.db, `sterilisasi/${userId}/sesi`);
    const makananRef = ref(this.db, `sterilisasi/${userId}/makanan`);
    const durasiRef = ref(this.db, `sterilisasi/${userId}/durasi`);
    return Promise.all([
      runTransaction(sesiRef, (curr: any) => (typeof curr === 'number' ? curr + 1 : 1)) as any,
      set(makananRef, makanan),
      set(durasiRef, durasi),
    ]).then(() => {});
  }

  getSterilisasi(userId: string): Observable<{ sesi: number; durasi: number; makanan: string } | null> {
    return new Observable((subscriber) => {
      const nodeRef = ref(this.db, `sterilisasi/${userId}`);
      const cb = onValue(nodeRef, (snap) => {
        subscriber.next(snap.val());
      }, (err) => subscriber.error(err));
      return () => {
        try { off(nodeRef, 'value', cb as any); } catch {}
      };
    });
  }
}
