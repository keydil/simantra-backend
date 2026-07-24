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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ALLOWED_IMAGE_MIMES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  videoDiskStorage,
  videoFileFilter,
} from '../storage/storage.service';
import {
  CreateTenantDto,
  ListTenantsQueryDto,
  UpdateRunningTextDto,
  UpdateTenantDto,
  UpdateThemeDto,
} from './dto/tenants.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Roles('superadmin')
  @Get()
  list(@Query() query: ListTenantsQueryDto) {
    return this.tenants.list(query);
  }

  @Roles('superadmin')
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  // TenantScopeGuard: admin otomatis dibatasi tenant sendiri via :tenantId
  @Roles('superadmin', 'admin')
  @Get(':tenantId')
  getById(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.getById(tenantId);
  }

  @Roles('superadmin')
  @Patch(':tenantId')
  update(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(tenantId, dto);
  }

  @Roles('superadmin')
  @Delete(':tenantId')
  softDelete(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.softDelete(tenantId);
  }

  /** Ringkasan data yang akan ikut hancur — untuk layar konfirmasi hard delete. */
  @Roles('superadmin')
  @Get(':tenantId/purge-preview')
  purgePreview(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.purgePreview(tenantId);
  }

  /**
   * HARD DELETE, tidak bisa dibatalkan (bandingkan dengan @Delete(':tenantId')
   * di atas yang cuma soft delete). Sengaja diberi path sendiri, BUKAN query
   * flag seperti `?hard=true`, supaya tidak mungkin terpicu karena salah ketik
   * parameter — dan supaya terbaca jelas di log akses.
   *
   * Tenant wajib sudah nonaktif; validasinya di service.
   */
  @Roles('superadmin')
  @Delete(':tenantId/permanent')
  purge(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.purge(tenantId);
  }

  @Roles('superadmin', 'admin')
  @Get(':tenantId/theme')
  getTheme(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.getTheme(tenantId);
  }

  // Theme = identitas brand → dikunci superadmin (reversal B1, sejajar D1
  // profil instansi). GET di atas tetap boleh admin (untuk tampil read-only).
  @Roles('superadmin')
  @Patch(':tenantId/theme')
  updateTheme(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: UpdateThemeDto) {
    return this.tenants.updateTheme(tenantId, dto);
  }

  // Logo = identitas brand → dikunci superadmin (reversal B1). Tak ada UI admin
  // yang memanggil ini; hanya alur superadmin "Tambah Instansi".
  @Roles('superadmin')
  @Post(':tenantId/logo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  uploadLogo(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File logo wajib diunggah (field "file")');
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Tipe file tidak didukung (hanya JPEG/PNG/WebP)');
    }
    return this.tenants.uploadLogo(tenantId, file.buffer, file.mimetype);
  }

  /**
   * E7 Video Display — video signage per instansi (self-manage admin, sejajar
   * pengaturan tampilan instansinya). BEDA guard dari logo di atas: logo =
   * identitas brand (superadmin), video = konten tampilan operasional (admin).
   *
   * Pakai diskStorage (bukan memoryStorage seperti logo): file bisa s/d 50 MB,
   * jadi di-stream ke disk. fileFilter menolak tipe non-video sebelum ditulis.
   */
  @Roles('superadmin', 'admin')
  @Post(':tenantId/video')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoDiskStorage(),
      fileFilter: videoFileFilter,
      limits: { fileSize: MAX_VIDEO_BYTES },
    }),
  )
  uploadVideo(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File video wajib diunggah (field "file")');
    return this.tenants.uploadVideo(tenantId, file.filename);
  }

  @Roles('superadmin', 'admin')
  @Delete(':tenantId/video')
  removeVideo(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenants.removeVideo(tenantId);
  }

  /**
   * Teks berjalan display = konten operasional tampilan instansi → self-manage
   * admin (sejajar video, BEDA dari theme/logo yang superadmin-only). Kirim
   * running_text "" untuk mengosongkan → display balik ke teks default.
   */
  @Roles('superadmin', 'admin')
  @Patch(':tenantId/running-text')
  updateRunningText(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateRunningTextDto,
  ) {
    return this.tenants.updateRunningText(tenantId, dto.running_text);
  }
}
