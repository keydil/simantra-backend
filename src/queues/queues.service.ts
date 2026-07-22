import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { toWireQueue } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateQueueDto, ListQueuesQueryDto, UpdateQueueDto } from './dto/queues.dto';

@Injectable()
export class QueuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listByTenant(tenantId: string, query: ListQueuesQueryDto) {
    const queues = await this.prisma.queue.findMany({
      where: {
        tenantId,
        ...(query.is_active !== undefined ? { isActive: query.is_active === 'true' } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return queues.map(toWireQueue);
  }

  async create(tenantId: string, dto: CreateQueueDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan');

    const queue = await this.prisma.queue.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        displayName: dto.display_name ?? null,
        serviceCode: dto.service_code ?? null,
        ...(dto.color_code ? { colorCode: dto.color_code } : {}),
        ...(dto.max_capacity !== undefined ? { maxCapacity: dto.max_capacity } : {}),
        ...(dto.estimated_service_time_minutes !== undefined
          ? { estimatedServiceTimeMinutes: dto.estimated_service_time_minutes }
          : {}),
      },
    });
    this.realtime.emitQueueUpdated(tenant, queue);
    return toWireQueue(queue);
  }

  async getById(id: string, caller: AuthUser) {
    const queue = await this.getScoped(id, caller);
    return toWireQueue(queue);
  }

  async update(id: string, dto: UpdateQueueDto, caller: AuthUser) {
    const existing = await this.getScoped(id, caller);
    const queue = await this.prisma.queue.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.display_name !== undefined ? { displayName: dto.display_name } : {}),
        ...(dto.service_code !== undefined ? { serviceCode: dto.service_code } : {}),
        ...(dto.color_code !== undefined ? { colorCode: dto.color_code } : {}),
        ...(dto.max_capacity !== undefined ? { maxCapacity: dto.max_capacity } : {}),
        ...(dto.estimated_service_time_minutes !== undefined
          ? { estimatedServiceTimeMinutes: dto.estimated_service_time_minutes }
          : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
      include: { tenant: true },
    });
    this.realtime.emitQueueUpdated(queue.tenant, queue);
    return toWireQueue(queue);
  }

  async softDelete(id: string, caller: AuthUser) {
    await this.getScoped(id, caller);
    const queue = await this.prisma.queue.update({
      where: { id },
      data: { isActive: false },
      include: { tenant: true },
    });
    this.realtime.emitQueueUpdated(queue.tenant, queue);
    return toWireQueue(queue);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async getScoped(id: string, caller: AuthUser) {
    const queue = await this.prisma.queue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Layanan tidak ditemukan');
    if (caller.role !== 'superadmin' && queue.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke layanan ini');
    }
    return queue;
  }
}
