import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ALLOWED_IMAGE_MIMES, MAX_UPLOAD_BYTES } from '../storage/storage.service';
import { VisitPurposesService } from '../visit-purposes/visit-purposes.service';
import { CreateGuestBookDto, InstitutionsQueryDto, ListGuestBookQueryDto } from './dto/guest-book.dto';
import { GuestBookService } from './guest-book.service';

/** Permukaan publik buku tamu (§4.9) — anon + throttled. */
@Public()
@Controller('public/tenants/:slug/guest-book')
export class PublicGuestBookController {
  constructor(
    private readonly guestBook: GuestBookService,
    private readonly purposes: VisitPurposesService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  create(@Param('slug') slug: string, @Body() dto: CreateGuestBookDto) {
    return this.guestBook.createPublic(slug, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  uploadPhoto(@Param('slug') slug: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('File foto wajib diunggah (field "file")');
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Tipe file tidak didukung (hanya JPEG/PNG/WebP)');
    }
    return this.guestBook.uploadPhoto(slug, file.buffer, file.mimetype);
  }

  @Get('institutions')
  institutions(@Param('slug') slug: string, @Query() query: InstitutionsQueryDto) {
    return this.guestBook.listInstitutions(slug, query);
  }

  // Opsi chip "Keperluan Kunjungan" untuk form publik — hanya yang aktif,
  // urut sort_order. Logikanya di VisitPurposesService (satu sumber), rutenya
  // di sini supaya sebidang dengan endpoint publik buku tamu lain.
  @Get('purposes')
  listPurposes(@Param('slug') slug: string) {
    return this.purposes.listPublic(slug);
  }
}

/** Halaman admin buku tamu — scope via TenantScopeGuard. */
@Controller('tenants/:tenantId/guest-book')
export class GuestBookController {
  constructor(private readonly guestBook: GuestBookService) {}

  @Roles('superadmin', 'admin')
  @Get()
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Query() query: ListGuestBookQueryDto) {
    return this.guestBook.listByTenant(tenantId, query);
  }
}
