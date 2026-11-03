import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/client.js';

// AZ-05: admin roles are hierarchical. SUPPORT reads and handles reports, EDITOR curates content
// (styles, featured designs), ADMIN runs operations (users, settings, billing, deletions) and only
// SUPER_ADMIN manages admins and their MFA.
export const ADMIN_ROLES = ['SUPPORT', 'EDITOR', 'ADMIN', 'SUPER_ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

const LEVEL: Record<Role, number> = { USER: 0, SUPPORT: 1, EDITOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };

export const isAdminRole = (role: Role): role is AdminRole => LEVEL[role] > 0;
export const atLeast = (role: Role, need: AdminRole) => LEVEL[role] >= LEVEL[need];

export const MIN_ROLE = 'admin:minRole';
/** Least role allowed on an admin route. AZ-01: a route that doesn't declare one is denied (fail closed). */
export const MinRole = (role: AdminRole) => SetMetadata(MIN_ROLE, role);
