import { Controller, Get } from '@nestjs/common';
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
  async check() {
    let db = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, timestamp: new Date().toISOString() };
  }
}
