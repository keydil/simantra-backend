import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateMaintenanceDto } from './dto/system.dto';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  // Publik: dipanggil halaman kiosk/display/buku-tamu untuk memutuskan apakah
  // harus menampilkan layar pemeliharaan. Tanpa auth (pengunjung anonim), dan
  // supaya polling tidak menyeret ke jalur sesi-habis — sama alasannya dengan
  // /health.
  @Public()
  @Get('maintenance-status')
  getMaintenanceStatus() {
    return this.system.getMaintenanceStatus();
  }

  @Roles('superadmin')
  @Patch('maintenance')
  updateMaintenance(@Body() dto: UpdateMaintenanceDto) {
    return this.system.updateMaintenance(dto);
  }
}
