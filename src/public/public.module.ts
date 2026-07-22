import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [RealtimeModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
