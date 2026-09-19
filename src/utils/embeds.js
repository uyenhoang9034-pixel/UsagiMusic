import { EmbedBuilder } from 'discord.js';

function resolveColor(color) {
  if (typeof color === 'number') return color;
  const colors = {
    primary: 0xffb7d5,
    success: 0xffb7d5,
    info: 0xffb7d5,
    warning: 0xffc86b,
    error: 0xff6b81,
  };
  return colors[color] ?? colors.primary;
}

export function createEmbed({
  title = '',
  description = '',
  color = 'primary',
  footer = null,
  thumbnail = null,
  image = null,
} = {}) {
  const embed = new EmbedBuilder().setColor(resolveColor(color));
  if (title) embed.setTitle(String(title).slice(0, 256));
  if (description) embed.setDescription(String(description).slice(0, 4096));
  if (footer) embed.setFooter({ text: typeof footer === 'string' ? footer : footer.text });
  if (thumbnail) embed.setThumbnail(typeof thumbnail === 'string' ? thumbnail : thumbnail.url);
  if (image) embed.setImage(typeof image === 'string' ? image : image.url);
  return embed;
}

export function successEmbed(title, description = '') {
  return createEmbed({ title, description, color: 'success' });
}
