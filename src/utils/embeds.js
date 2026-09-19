import { EmbedBuilder } from 'discord.js';
export function successEmbed(title, description) {
  return new EmbedBuilder().setColor(0xffb6d9).setTitle(title).setDescription(description);
}
