import PocketBase from 'pocketbase';

const pb = new PocketBase(process.env.POCKETBASE_URL || 'https://bmaestro-pocketbase.fly.dev');

// Optional admin auth - collections have open API rules so this isn't required
export async function initPocketBase(): Promise<void> {
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {
    try {
      await pb.admins.authWithPassword(adminEmail, adminPassword);
      console.log('[PocketBase] Authenticated as admin');
    } catch (err) {
      console.warn('[PocketBase] Admin auth failed (continuing without):', err);
    }
  } else {
    console.log('[PocketBase] Running without admin auth (using API rules)');
  }
}

export { pb };
