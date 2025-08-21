import { Auth } from '@angular/fire/auth';

const ADMIN_UIDS = new Set<string>([
  '2ktb9nWf5uTYCicuIvk4oCXO1tg2',
  'pLRR7n7yhfPsYABrS2xueswuA8a2',
  'mRnGcFfG7RTKfL4qFD9g7UKJx8s2',
]);

const ADMIN_EMAILS = new Set<string>([
  'fadhilahnormaghfiroh@gmail.com',
  'mayjesty@gmail.com',
  'calyakaisha804@gmail.com',
]);

export function isAdminByUidOrEmail(uid?: string | null, email?: string | null): boolean {
  if (!uid && !email) return false;
  if (uid && ADMIN_UIDS.has(uid)) return true;
  if (email && ADMIN_EMAILS.has(email.toLowerCase())) return true;
  return false;
}

export function isAdmin(auth: Auth): boolean {
  const u = auth.currentUser;
  return !!u && isAdminByUidOrEmail(u.uid, u.email || null);
}
