import PocketBase from 'pocketbase'

// Singleton PocketBase client.
// Base URL '/' works because the embedded AppOS HTTP frontend serves /api/ on the same origin.
export const pb = new PocketBase('/')
