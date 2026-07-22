import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateVisitPurposeDto, UpdateVisitPurposeDto } from './dto/visit-purposes.dto';
import { VisitPurposesService } from './visit-purposes.service';

// Mengikuti pola queues.controller: @Controller() kosong + path penuh per
// method (base path campuran /tenants/:tenantId/... dan /guest-book/purposes/:id).
@Controller()
export class VisitPurposesController {
  constructor(private readonly purposes: VisitPurposesService) {}

  // Read: semua role staff (scope via TenantScopeGuard pada :tenantId).
  @Get('tenants/:tenantId/guest-book/purposes')
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.purposes.listByTenant(tenantId);
  }

  @Roles('superadmin', 'admin')
  @Post('tenants/:tenantId/guest-book/purposes')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateVisitPurposeDto) {
    return this.purposes.create(tenantId, dto);
  }

  @Roles('superadmin', 'admin')
  @Patch('guest-book/purposes/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitPurposeDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.purposes.update(id, dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Delete('guest-book/purposes/:id')
  softDelete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthUser) {
    return this.purposes.softDelete(id, caller);
  }
}
