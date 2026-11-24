import { isRoomId } from "@ember/protocol";
import { credentialsOf, isHttps } from "./auth";
import type { Env } from "./env";
import { pulseBinding } from "./pulse";
import { workspace } from "./workspace";

export async function lanOnboarding(request: Request, env: Env, receipt = false) {
  const reply = (value: object, status = 200) => Response.json(value, {status, headers:{"Cache-Control":"no-store"}});
  if (!env.EMBER_LAN_WORKSPACE_ID || !env.EMBER_LAN_CLIENT_RELEASE || !isHttps(request)) return reply({error:"not_found"}, 404);
  const work = workspace(env);
  const credentials = await credentialsOf(request, env);
  const user = credentials && await work.authenticate(credentials);
  if (!receipt) {
    const account = await work.account();
    if (!account) return reply({error:"workspace_not_ready"}, 503);
    return reply({workspace_id:env.EMBER_LAN_WORKSPACE_ID, workspace:account.name,
      client_release:env.EMBER_LAN_CLIENT_RELEASE, member:user ? {id:user.id, name:user.name} : null});
  }
  if (!credentials || !user) return reply({error:"sign_in_required"}, 401);
  const params = new URL(request.url).searchParams;
  const room = params.get("room"), revision = params.get("revision");
  if (!room || !isRoomId(room) || !revision || !/^[a-f0-9]{32}$/.test(revision)) return reply({error:"invalid_receipt"}, 400);
  const settings = await work.roomSettings(credentials, room);
  const binding = pulseBinding(env, room);
  if (!settings || settings === "not found" || !settings.people.some(person => person.member && person.id === user.id) ||
      (binding && !binding.allRoomMembers && !binding.memberIds.includes(user.id))) return reply({error:"receipt_not_accessible"}, 404);
  const result = await env.CHAT_ROOM.getByName(room).onboardingReceipt(room, revision, user.id, request.method === "POST");
  return result ? reply({...result, room_name:settings.room.name}) : reply({error:"receipt_not_accessible"}, 404);
}
