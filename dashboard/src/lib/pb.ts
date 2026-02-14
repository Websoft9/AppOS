import PocketBase from 'pocketbase';

// Singleton PocketBase client.
// Base URL '/' works because internal Nginx proxies /api/ → PocketBase.
export const pb = new PocketBase('/');
