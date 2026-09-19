export const InteractionHelper = {
  async safeDefer(interaction, options = {}) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(options);
      }
      return true;
    } catch {
      return false;
    }
  },

  async safeEditReply(interaction, payload) {
    try {
      return await interaction.editReply(payload);
    } catch {
      return null;
    }
  },

  async safeReply(interaction, payload) {
    try {
      if (interaction.deferred) {
        return await interaction.editReply(payload);
      }
      if (interaction.replied) {
        return await interaction.followUp(payload);
      }
      return await interaction.reply(payload);
    } catch {
      return null;
    }
  },
};
