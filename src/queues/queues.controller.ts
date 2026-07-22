import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateQueueDto, ListQueuesQueryDto, UpdateQueueDto } from './dto/queues.dto';
import { QueuesService } from './queues.service';

@Controller()
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  // Read: semua role staff (scope via TenantScopeGuard)
  @Get('tenants/:tenantId/queues')
  list(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Query() query: ListQueuesQueryDto) {
    return this.queues.listByTenant(tenantId, query);
  }

  @Roles('superadmin', 'admin')
  @Post('tenants/:tenantId/queues')
  create(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateQueueDto) {
    return this.queues.create(tenantId, dto);
  }

  @Get('queues/:id')
  getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthUser) {
    return this.queues.getById(id, caller);
  }

  @Roles('superadmin', 'admin')
  @Patch('queues/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQueueDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.queues.update(id, dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Delete('queues/:id')
  softDelete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthUser) {
    return this.queues.softDelete(id, caller);
  }
}
