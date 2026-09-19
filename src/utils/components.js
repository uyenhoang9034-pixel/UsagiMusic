import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function getPaginationRow(customIdPrefix = 'page', currentPage = 1, totalPages = 1) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}_first`)
      .setLabel('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}_prev`)
      .setLabel('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}_page`)
      .setLabel(`Page ${currentPage} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}_next`)
      .setLabel('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}_last`)
      .setLabel('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
  );
}
