import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';

@Module({
  imports: [RealtimeModule],
  controllers: [QueuesController],
  providers: [QueuesService],
})
export class QueuesModule {}
