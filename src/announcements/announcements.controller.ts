import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcements.dto';

@Controller()
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Roles('superadmin')
  @Get('announcements')
  listAll() {
    return this.announcements.listAll();
  }

  @Roles('superadmin')
  @Post('announcements')
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() caller: AuthUser) {
    return this.announcements.create(dto, caller.id);
  }

  @Roles('superadmin')
  @Patch('announcements/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(id, dto);
  }

  @Roles('superadmin')
  @Delete('announcements/:id')
  softDelete(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.softDelete(id);
  }

  /** Bell/banner admin & operator (enabler fix UI_UX 1.1). */
  @Get('tenants/:tenantId/announcements/active')
  listActive(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.announcements.listActiveForTenant(tenantId);
  }

  /** Display board publik — hanya maintenance/warning, field di-whitelist. */
  @Public()
  @Get('public/tenants/:slug/announcements/active')
  listActivePublic(@Param('slug') slug: string) {
    return this.announcements.listActiveForTenantPublic(slug);
  }
}
