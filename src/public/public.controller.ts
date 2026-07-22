import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreatePublicEntryDto, PublicEntriesQueryDto } from './dto/public.dto';
import { PublicService } from './public.service';

/**
 * SELURUH permukaan anon ada di controller ini (§1 DESIGN.md) — semua
 * handler @Public + throttled, scoping eksplisit via slug/UUID.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('tenants/:slug')
  getTenant(@Param('slug') slug: string) {
    return this.service.getTenant(slug);
  }

  @Get('tenants/:slug/queues')
  getQueues(@Param('slug') slug: string) {
    return this.service.getQueues(slug);
  }

  @Get('tenants/:slug/entries')
  getEntries(@Param('slug') slug: string, @Query() query: PublicEntriesQueryDto) {
    return this.service.getEntries(slug, query);
  }

  @Get('entries/:id')
  getEntry(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getEntry(id);
  }

  @Get('entries/:id/position')
  getPosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPosition(id);
  }

  @Get('queues/:id')
  getQueue(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getQueue(id);
  }

  /** Ambil nomor antrian — throttle ketat per-IP (L9). */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('tenants/:slug/queues/:queueId/entries')
  createEntry(
    @Param('slug') slug: string,
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @Body() dto: CreatePublicEntryDto,
  ) {
    return this.service.createEntry(slug, queueId, dto);
  }
}
