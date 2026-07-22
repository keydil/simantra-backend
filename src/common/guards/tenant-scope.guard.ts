import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../../auth/auth.types';

/**
 * Route dengan param `:tenantId` atau `:slug` otomatis di-scope ke tenant user
 * (superadmin lolos selalu — tenant_id null = lintas tenant). Route yang
 * scope-nya baru ketahuan dari resource (mis. /users/:id, /entries/:id)
 * divalidasi di service, bukan di sini. (§2.2 DESIGN.md)
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    if (!user) return true; // route publik — scoping dilakukan handler-nya sendiri
    if (user.role === 'superadmin') return true;

    const { tenantId, slug } = request.params ?? {};
    if (tenantId && tenantId !== user.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke tenant ini');
    }
    if (slug && slug !== user.tenantSlug) {
      throw new ForbiddenException('Tidak punya akses ke tenant ini');
    }
    return true;
  }
}
