import {
  GuildMember,
  PermissionsBitField,
  ChatInputCommandInteraction,
  ButtonInteraction,
  UserSelectMenuInteraction,
  GuildMemberRoleManager,
} from 'discord.js';
import { config } from '../config.js';

type InteractionWithMember =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | UserSelectMenuInteraction;

/**
 * Checks whether the user executing an interaction has administrator or manager privileges,
 * or possesses the configured ADMIN_ROLE_ID.
 */
export function isUserAdmin(interaction: InteractionWithMember): boolean {
  // If invoked in a guild, check permissions
  if (interaction.memberPermissions) {
    if (
      interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) ||
      interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)
    ) {
      return true;
    }
  }

  // Check configured admin role
  if (config.adminRoleId && interaction.member && 'roles' in interaction.member) {
    const roles = interaction.member.roles;
    if (roles) {
      if (Array.isArray(roles) && roles.includes(config.adminRoleId)) {
        return true;
      }
      if (roles instanceof GuildMemberRoleManager) {
        if (roles.cache.has(config.adminRoleId)) {
          return true;
        }
      } else if (
        typeof roles === 'object' &&
        'cache' in roles &&
        typeof roles.cache === 'object' &&
        roles.cache !== null &&
        'has' in roles.cache &&
        typeof (roles.cache as { has: unknown }).has === 'function'
      ) {
        const cache = roles.cache as { has: (key: string) => boolean };
        if (cache.has(config.adminRoleId)) {
          return true;
        }
      }
    }
  }

  return false;
}

