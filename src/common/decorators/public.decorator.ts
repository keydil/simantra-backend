import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Tandai handler/controller sebagai anon (skip JwtAuthGuard). Endpoint publik
 *  WAJIB melakukan scoping eksplisit sendiri (slug/UUID) — lihat L1 DESIGN.md. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
