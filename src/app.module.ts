import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AnalyticsModule } from './analytics/analytics.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { SystemModule } from './system/system.module';
import { VisitPurposesModule } from './visit-purposes/visit-purposes.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthModule } from './auth/auth.module';
import { GuestBookModule } from './guest-book/guest-book.module';
import { QueuesModule } from './queues/queues.module';
import { StorageModule } from './storage/storage.module';
import { TenantsModule } from './tenants/tenants.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantScopeGuard } from './common/guards/tenant-scope.guard';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { PublicModule } from './public/public.module';
import { QueueEntriesModule } from './queue-entries/queue-entries.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Konfigurasi dasar untuk DI (options/storage) yang dibutuhkan
    // ThrottlerGuard bawaan — limit AKTUAL yang berlaku ditentukan
    // AppThrottlerGuard di bawah (bucket beda utk publik vs staff, lihat
    // komentar di guard-nya). Endpoint publik ber-write dapat limit lebih
    // ketat lagi via @Throttle() di handler-nya (L9 DESIGN.md).
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL_MS ?? 60000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    RealtimeModule,
    QueueEntriesModule,
    PublicModule,
    TenantsModule,
    QueuesModule,
    GuestBookModule,
    AnnouncementsModule,
    AnalyticsModule,
    SystemModule,
    VisitPurposesModule,
    SponsorsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Rantai guard §2.2 DESIGN.md — urutan registrasi = urutan eksekusi.
    // AppThrottlerGuard jalan SEBELUM JwtAuthGuard (request.user belum ada),
    // makanya ia baca metadata @Public() sendiri, bukan request.user.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: TenantScopeGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
  ],
})
export class AppModule {}
