import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { AggregateDto, AnalyticsRangeQueryDto, QueueAnalyticsQueryDto } from './dto/analytics.dto';

@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Dipakai dashboard superadmin DAN halaman analitik admin (fix UI_UX 1.2). */
  @Get('tenants/:tenantId/analytics')
  listByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: AnalyticsRangeQueryDto,
  ) {
    return this.analytics.listByTenant(tenantId, query);
  }

  @Get('queues/:queueId/analytics')
  listByQueue(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @Query() query: QueueAnalyticsQueryDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.analytics.listByQueue(queueId, query, caller);
  }

  /** Trigger manual agregasi (testing/backfill) — cron tetap jalan otomatis. */
  @Roles('superadmin')
  @Post('analytics/aggregate')
  async aggregate(@Body() dto: AggregateDto) {
    // `days` diprioritaskan: backfill N hari terakhir termasuk hari ini.
    if (dto.days) {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - (dto.days - 1));
      return this.analytics.aggregateRange(from, to);
    }
    const date = dto.date ? new Date(dto.date) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const upserted = await this.analytics.aggregateForDate(date);
    return { upserted };
  }
}
