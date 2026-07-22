import { SetMetadata } from '@nestjs/common';

export const ALLOW_MUST_CHANGE_PASSWORD_KEY = 'allowMustChangePassword';

/** Handler yang tetap boleh diakses saat user masih wajib ganti password
 *  (change-password, me, logout) — lihat §2.2 DESIGN.md. */
export const AllowMustChangePassword = () => SetMetadata(ALLOW_MUST_CHANGE_PASSWORD_KEY, true);
