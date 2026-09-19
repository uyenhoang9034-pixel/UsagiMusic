export const InteractionHelper={
 async safeDefer(interaction,options={}){ try{ if(!interaction.deferred&&!interaction.replied) await interaction.deferReply(options); return true;}catch{return false;} },
 async safeEditReply(interaction,payload){ try{return await interaction.editReply(payload);}catch{return null;} }
};
