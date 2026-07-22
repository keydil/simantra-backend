import { Role } from '@prisma/client';

/** Claims JWT — bentuk snake_case dipertahankan sama dengan
 *  custom_access_token_hook Supabase lama (script 11) supaya migrasi
 *  middleware.ts frontend minim (§2.1 DESIGN.md). */
export interface JwtPayload {
  sub: string;
  role: Role;
  tenant_id: string | null;
  tenant_slug: string | null;
  must_change_password: boolean;
}

/** request.user hasil JwtStrategy.validate() */
export interface AuthUser {
  id: string;
  role: Role;
  tenantId: string | null;
  tenantSlug: string | null;
  mustChangePassword: boolean;
}
