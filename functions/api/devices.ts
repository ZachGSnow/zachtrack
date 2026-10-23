import type { AccessDeps } from '../../server/access';
import { jsonResponse, listDevices, refuseUnlessOwner, type Env } from '../../server/endpoint';

// DELETE /api/devices?id=<device id>: forgets a device in the Sync page's list
// (a phone you replaced, say). Its activity rows stay until they age out. A
// device that syncs again comes back on its own; signing a device out is
// Cloudflare Access's job, not this list's.

export const onRequestDelete: PagesFunction<Env> = (context) => handleForgetDevice(context.request, context.env);

export async function handleForgetDevice(request: Request, env: Env, deps: AccessDeps = {}): Promise<Response> {
  const refused = await refuseUnlessOwner(request, env, deps, 'devices');
  if (refused) return refused;

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return jsonResponse({ error: 'Invalid device id' }, 400);
  try {
    await env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id).run();
    return jsonResponse({ devices: await listDevices(env.DB) });
  } catch (err) {
    console.error('devices: failed', err);
    return jsonResponse({ error: 'Could not forget the device' }, 500);
  }
}
