/**
 * APNs push sender — sends a notification to every device a user registered.
 *
 * Uses Apple's token-based auth (a .p8 key), signed as an ES256 JWT, over
 * HTTP/2 to api.push.apple.com. No external dependency: Node's built-in
 * `crypto` (JWT) + `http2` (request).
 *
 * Configured via env (set these on Vercel from your Apple Developer APNs key):
 *   APNS_KEY_ID       — the Key ID of your .p8 APNs key
 *   APNS_TEAM_ID      — your Apple Developer Team ID
 *   APNS_PRIVATE_KEY  — the FULL contents of the .p8 file (PEM, newlines ok)
 *   APNS_BUNDLE_ID    — the app bundle id (com.calabrese.little-explorer-ios)
 *   APNS_PRODUCTION   — "1" for the production APNs host (TestFlight/App Store),
 *                       anything else uses the sandbox host (dev builds).
 *
 * If any of the first four are missing, every call is a logged no-op — so the
 * whole pipeline ships safely before the key is configured.
 */
import crypto from 'crypto';
import http2 from 'http2';
import { supabaseAdmin } from './db';

interface PushPayload {
  title: string;
  body:  string;
  /** Extra keys merged into the APNs payload (e.g. { activityId }). */
  data?: Record<string, unknown>;
}

function config() {
  const keyId  = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const key    = process.env.APNS_PRIVATE_KEY;
  const bundle = process.env.APNS_BUNDLE_ID;
  if (!keyId || !teamId || !key || !bundle) return null;
  // Vercel env vars keep literal "\n" — turn them back into real newlines.
  const privateKey = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  const host = process.env.APNS_PRODUCTION === '1' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  return { keyId, teamId, privateKey, bundle, host };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build (and cache for ~50 min) the APNs provider JWT. */
let cachedJwt: { token: string; exp: number } | null = null;
function providerToken(cfg: NonNullable<ReturnType<typeof config>>): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.exp > now + 60) return cachedJwt.token;
  const header  = base64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const payload = base64url(JSON.stringify({ iss: cfg.teamId, iat: now }));
  const signature = crypto
    .createSign('SHA256')
    .update(`${header}.${payload}`)
    .sign({ key: cfg.privateKey, dsaEncoding: 'ieee-p1363' });
  const token = `${header}.${payload}.${base64url(signature)}`;
  cachedJwt = { token, exp: now + 3000 }; // Apple allows up to 1h; refresh at 50 min
  return token;
}

/** Send one push to one device token. Resolves to the token if APNs rejected it
 *  as gone (410 BadDeviceToken / Unregistered) so the caller can prune it. */
function sendOne(
  cfg: NonNullable<ReturnType<typeof config>>,
  jwt: string,
  deviceToken: string,
  payload: PushPayload,
): Promise<{ token: string; dead: boolean }> {
  return new Promise(resolve => {
    let settled = false;
    const done = (dead: boolean) => { if (!settled) { settled = true; resolve({ token: deviceToken, dead }); } };
    let client: http2.ClientHttp2Session;
    try {
      client = http2.connect(cfg.host);
    } catch { done(false); return; }
    client.on('error', () => done(false));

    const body = JSON.stringify({
      aps: { alert: { title: payload.title, body: payload.body }, sound: 'default', badge: 1 },
      ...(payload.data ?? {}),
    });
    const req = client.request({
      ':method': 'POST',
      ':path':   `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': cfg.bundle,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });
    let status = 0;
    let respBody = '';
    req.on('response', headers => { status = Number(headers[':status']) || 0; });
    req.on('data', chunk => { respBody += chunk; });
    req.on('end', () => {
      if (status >= 400) {
        const reason = (() => { try { return (JSON.parse(respBody) as { reason?: string }).reason; } catch { return ''; } })();
        console.warn(`[push] APNs ${status} for token …${deviceToken.slice(-6)}: ${reason}`);
        done(status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered');
      } else {
        done(false);
      }
      client.close();
    });
    req.on('error', () => { done(false); try { client.close(); } catch { /* noop */ } });
    req.end(body);
  });
}

/**
 * Send a push to every device the user registered. Fire-and-forget friendly
 * (callers `void` it). No-ops (with a debug log) when APNs isn't configured.
 * Prunes tokens APNs reports as dead.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const cfg = config();
  if (!cfg) { console.log('[push] APNs not configured — skipping'); return; }

  const { data, error } = await supabaseAdmin()
    .schema('next_auth').from('device_tokens').select('token').eq('user_id', userId);
  if (error) { console.warn('[push] token lookup failed:', error.message); return; }
  const tokens = (data ?? []).map(r => r.token as string);
  if (tokens.length === 0) return;

  let jwt: string;
  try { jwt = providerToken(cfg); } catch (e) { console.error('[push] JWT sign failed:', (e as Error).message); return; }

  const results = await Promise.all(tokens.map(t => sendOne(cfg, jwt, t, payload)));
  const dead = results.filter(r => r.dead).map(r => r.token);
  if (dead.length) {
    await supabaseAdmin().schema('next_auth').from('device_tokens').delete().in('token', dead);
  }
}
