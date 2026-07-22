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
import { UsersService } from './users.service';
import { CreateUserDto, ListUsersQueryDto, ResetPasswordDto, UpdateUserDto } from './dto/users.dto';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // TenantScopeGuard memastikan admin hanya bisa tenant sendiri
  @Roles('superadmin', 'admin')
  @Get('tenants/:tenantId/users')
  list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListUsersQueryDto,
  ) {
    return this.users.listByTenant(tenantId, query);
  }

  @Roles('superadmin')
  @Get('users/superadmins')
  listSuperadmins() {
    return this.users.listSuperadmins();
  }

  @Roles('superadmin', 'admin')
  @Post('users')
  create(@Body() dto: CreateUserDto, @CurrentUser() caller: AuthUser) {
    return this.users.create(dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Patch('users/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.users.update(id, dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Post('users/:id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() caller: AuthUser,
  ) {
    return this.users.resetPassword(id, dto, caller);
  }

  @Roles('superadmin', 'admin')
  @Delete('users/:id')
  softDelete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthUser) {
    return this.users.softDelete(id, caller);
  }
}
