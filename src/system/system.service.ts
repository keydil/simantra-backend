import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMaintenanceDto } from './dto/system.dto';

// Baris config global disimpan sebagai singleton dengan id konstan.
const CONFIG_ID = 'global';

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pastikan baris singleton ada, lalu kembalikan. */
  private async ensureConfig() {
    return this.prisma.systemConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  /** Dipanggil halaman publik (endpoint @Public). Bentuknya sengaja minimal —
   *  jangan bocorkan field internal ke pengunjung anonim. */
  async getMaintenanceStatus() {
    const config = await this.ensureConfig();
    return {
      active: config.maintenanceMode,
      message: config.maintenanceMessage ?? undefined,
    };
  }

  async updateMaintenance(dto: UpdateMaintenanceDto) {
    const config = await this.prisma.systemConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        maintenanceMode: dto.active,
        maintenanceMessage: dto.message?.trim() || null,
      },
      update: {
        maintenanceMode: dto.active,
        maintenanceMessage: dto.message?.trim() || null,
      },
    });
    return {
      active: config.maintenanceMode,
      message: config.maintenanceMessage ?? undefined,
    };
  }
}
