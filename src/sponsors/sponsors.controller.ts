import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ALLOWED_IMAGE_MIMES, MAX_UPLOAD_BYTES } from '../storage/storage.service';
import { UpdateSponsorDto } from './dto/sponsors.dto';
import { SponsorsService } from './sponsors.service';

// Mengikuti pola announcements.controller: @Controller() kosong + path penuh
// per method, campur admin (tenants/:tenantId/...) & publik (public/tenants/:slug/...).
@Controller()
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  // Read: semua role staff (scope via TenantScopeGuard pada :tenantId).
  @Get('tenants/:tenantId/sponsors')
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.sponsors.listByTenant(tenantId);
  }

  @Roles('superadmin', 'admin')
  @Post('tenants/:tenantId/sponsors')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body('name') name: string | undefined,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File logo wajib diunggah (field "file")');
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Tipe file tidak didukung (hanya JPEG/PNG/WebP)');
    }
    return this.sponsors.create(tenantId, file.buffer, file.mimetype, name);
  }

  @Roles('superadmin', 'admin')
  @Patch('sponsors/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSponsorDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.sponsors.update(id, dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Delete('sponsors/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthUser) {
    return this.sponsors.remove(id, caller);
  }

  /** Display board publik — hanya aktif, urut sort_order. */
  @Public()
  @Get('public/tenants/:slug/sponsors')
  listPublic(@Param('slug') slug: string) {
    return this.sponsors.listPublic(slug);
  }
}
