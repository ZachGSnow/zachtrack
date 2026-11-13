// Makes the key pair the server signs reminders with (VAPID, RFC 8292) and
// says where each half goes. Run once: `npm run vapid-keys`. A new pair
// means every device has to turn reminders on again. See README "Reminders".

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

console.log(`Public key (not secret): ${b64url(publicRaw)}
  Put it in wrangler.toml [vars] as VAPID_PUBLIC_KEY, and in workers/backup/wrangler.toml [vars] too.

Private key (secret, keep it out of files): ${d}
  Paste it when asked by both of:
    npx wrangler pages secret put VAPID_PRIVATE_KEY
    cd workers/backup && npx wrangler secret put VAPID_PRIVATE_KEY`);
