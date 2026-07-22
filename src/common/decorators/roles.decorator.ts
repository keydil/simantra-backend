import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Tanpa dekorator ini, semua role authenticated boleh mengakses handler. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
