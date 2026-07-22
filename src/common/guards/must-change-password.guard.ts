import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../../auth/auth.types';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';

/**
 * Bagian dari fix permanen ghost account (§2.3 DESIGN.md): user baru login
 * dengan password buatan admin, lalu diblokir dari semua endpoint sampai
 * mengganti password sendiri.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user?.mustChangePassword) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException({
      statusCode: 403,
      message: 'Wajib mengganti password terlebih dahulu sebelum melanjutkan',
      error: 'MUST_CHANGE_PASSWORD',
    });
  }
}
