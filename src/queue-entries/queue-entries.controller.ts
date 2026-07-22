import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CallNextDto,
  ListEntriesQueryDto,
  UpdateEntryDto,
  UpdateEntryStatusDto,
} from './dto/queue-entries.dto';
import { QueueEntriesService } from './queue-entries.service';

@Controller()
export class QueueEntriesController {
  constructor(private readonly entries: QueueEntriesService) {}

  // Read: semua role authenticated (viewer termasuk); scope via TenantScopeGuard
  @Get('tenants/:tenantId/entries')
  list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListEntriesQueryDto,
  ) {
    return this.entries.listByTenant(tenantId, query);
  }

  @Get('tenants/:tenantId/entries/summary')
  summary(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.entries.summary(tenantId);
  }

  @Get('queues/:queueId/stats/today')
  statsToday(@Param('queueId', ParseUUIDPipe) queueId: string, @CurrentUser() caller: AuthUser) {
    return this.entries.statsToday(queueId, caller);
  }

  @Roles('superadmin', 'admin', 'operator')
  @Post('queues/:queueId/call-next')
  callNext(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @Body() dto: CallNextDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.entries.callNext(queueId, dto, caller);
  }

  @Roles('superadmin', 'admin', 'operator')
  @Patch('entries/:id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntryStatusDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.entries.updateStatus(id, dto, caller);
  }

  @Roles('superadmin', 'admin', 'operator')
  @Patch('entries/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.entries.update(id, dto, caller);
  }
}
