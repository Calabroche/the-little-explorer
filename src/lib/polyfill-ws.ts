/**
 * WebSocket polyfill for Node 16.
 *
 * @supabase/supabase-js v2.x instantiates a RealtimeClient on every
 * createClient() call, even if you never use realtime. That constructor
 * throws "Node.js 16 detected without native WebSocket support" because
 * native WebSocket only landed in Node 22+. On Vercel functions
 * (Node 20+ with the runtime polyfill) this is a no-op; on a local
 * Node 16 dev server it's the difference between NextAuth working and
 * silently failing with ?error=Configuration.
 *
 * Importing this file once at module load is enough — `globalThis.WebSocket`
 * survives the import cycle and stays set for the lifetime of the process.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (typeof g.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  g.WebSocket = require('ws');
}

export {};
