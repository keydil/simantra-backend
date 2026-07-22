import { Module } from '@nestjs/common';
import { VisitPurposesModule } from '../visit-purposes/visit-purposes.module';
import { GuestBookController, PublicGuestBookController } from './guest-book.controller';
import { GuestBookService } from './guest-book.service';

@Module({
  imports: [VisitPurposesModule],
  controllers: [PublicGuestBookController, GuestBookController],
  providers: [GuestBookService],
})
export class GuestBookModule {}
