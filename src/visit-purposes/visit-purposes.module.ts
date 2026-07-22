import { Module } from '@nestjs/common';
import { VisitPurposesController } from './visit-purposes.controller';
import { VisitPurposesService } from './visit-purposes.service';

@Module({
  controllers: [VisitPurposesController],
  providers: [VisitPurposesService],
  // Diekspor supaya PublicGuestBookController (modul guest-book) bisa
  // menyajikan endpoint publik purposes di sebelah institutions.
  exports: [VisitPurposesService],
})
export class VisitPurposesModule {}
