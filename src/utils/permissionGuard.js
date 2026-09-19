export function botHasPermission(channel, permissions=[]){
 const me=channel?.guild?.members?.me;
 if(!me) return false;
 const resolved=channel.permissionsFor(me);
 return Boolean(resolved&&resolved.has(permissions));
}
