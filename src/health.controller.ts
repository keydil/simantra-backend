import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Publik: health check konvensinya diakses tanpa auth (load balancer, uptime
  // monitor, indikator status di UI). Selain itu, indikator status yang polling
  // di latar TIDAK boleh ikut jalur "sesi habis" saat token kedaluwarsa —
  // dijadikan publik memutus rantai itu sepenuhnya.
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    // Status code ikut turun saat DB mati — healthcheck platform (Railway,
    // uptime monitor) umumnya cuma melihat kode, bukan isi body, jadi kalau
    // selalu 200 database mati tidak akan pernah terdeteksi.
    if (db === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: db === 'up' ? 'ok' : 'degraded', db, timestamp: new Date().toISOString() };
  }
}
