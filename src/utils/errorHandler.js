import { MessageFlags } from 'discord.js';
export const ErrorTypes = { CONFIGURATION:'CONFIGURATION', PERMISSION:'PERMISSION', USER_INPUT:'USER_INPUT' };
export class TitanBotError extends Error {
  constructor(message, type=ErrorTypes.CONFIGURATION, userMessage=message){ super(message); this.name='TitanBotError'; this.type=type; this.userMessage=userMessage; }
}
export async function handleInteractionError(interaction,error){
  const content=error?.userMessage||error?.message||'Có lỗi xảy ra khi xử lý Music.';
  try{
    if(interaction.deferred||interaction.replied) await interaction.followUp({content,flags:MessageFlags.Ephemeral});
    else await interaction.reply({content,flags:MessageFlags.Ephemeral});
  }catch{}
}
export async function replyUserError(interaction,{message}){
  try{
    if(interaction.deferred||interaction.replied) return interaction.followUp({content:message,flags:MessageFlags.Ephemeral});
    return interaction.reply({content:message,flags:MessageFlags.Ephemeral});
  }catch{}
}
