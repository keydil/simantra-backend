import { Injectable, Logger } from '@nestjs/common';
import { Announcement, Queue, QueueEntry } from '@prisma/client';
import { Server } from 'socket.io';
import {
  toWireAnnouncement,
  toWireEntry,
  toWirePublicAnnouncement,
  toWirePublicEntry,
  toWireQueue,
} from '../common/wire';

/**
 * Event bus realtime (§5 DESIGN.md). Dipanggil oleh service domain SETELAH
 * transaksi DB commit — gateway hanya mengelola koneksi/room, tidak pernah
 * jadi sumber mutasi. Room ter-scope, tidak ada room lintas-tenant (L1):
 *   tenant:{slug}:public   — TV/kiosk, payload publik tanpa customer_name
 *   tenant:{tenantId}:staff — panel operator/admin (JWT), payload penuh
 *   entry:{entryId}        — HP pemegang tiket (UUID = capability)
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  static publicRoom(slug: string) {
    return `tenant:${slug}:public`;
  }
  static staffRoom(tenantId: string) {
    return `tenant:${tenantId}:staff`;
  }
  static entryRoom(entryId: string) {
    return `entry:${entryId}`;
  }

  emitEntryCreated(tenant: { id: string; subdomain: string }, entry: QueueEntry) {
    this.emitEntryEvent('entry.created', tenant, entry);
  }

  emitEntryUpdated(tenant: { id: string; subdomain: string }, entry: QueueEntry) {
    this.emitEntryEvent('entry.updated', tenant, entry);
  }

  /** Khusus waiting→serving, supaya TV & status page bisa trigger TTS
   *  "dipanggil" tepat sekali (§5.2). */
  emitEntryCalled(
    tenant: { id: string; subdomain: string },
    entry: QueueEntry,
    queue?: Queue | null,
  ) {
    if (!this.server) return;
    const queuePayload = queue ? toWireQueue(queue) : null;
    this.server
      .to(RealtimeService.publicRoom(tenant.subdomain))
      .emit('entry.called', { entry: toWirePublicEntry(entry), queue: queuePayload });
    this.server
      .to(RealtimeService.staffRoom(tenant.id))
      .emit('entry.called', { entry: toWireEntry(entry), queue: queuePayload });
    this.server
      .to(RealtimeService.entryRoom(entry.id))
      .emit('entry.called', { entry: toWireEntry(entry), queue: queuePayload });
  }

  emitQueueUpdated(tenant: { id: string; subdomain: string }, queue: Queue) {
    if (!this.server) return;
    const payload = toWireQueue(queue);
    this.server.to(RealtimeService.publicRoom(tenant.subdomain)).emit('queue.updated', payload);
    this.server.to(RealtimeService.staffRoom(tenant.id)).emit('queue.updated', payload);
  }

  /** announcement.updated ke staff room semua tenant target; tipe
   *  maintenance/warning juga ke room publik (§5.2). */
  emitAnnouncementUpdated(
    announcement: Announcement,
    targetTenants: { id: string; subdomain: string }[],
  ) {
    if (!this.server) return;
    const staffPayload = toWireAnnouncement(announcement);
    const publicRelevant =
      announcement.announcementType === 'maintenance' || announcement.announcementType === 'warning';
    for (const t of targetTenants) {
      this.server.to(RealtimeService.staffRoom(t.id)).emit('announcement.updated', staffPayload);
      if (publicRelevant) {
        this.server
          .to(RealtimeService.publicRoom(t.subdomain))
          .emit('announcement.updated', toWirePublicAnnouncement(announcement));
      }
    }
  }

  private emitEntryEvent(
    event: 'entry.created' | 'entry.updated',
    tenant: { id: string; subdomain: string },
    entry: QueueEntry,
  ) {
    if (!this.server) {
      this.logger.warn(`emit ${event} dilewati — gateway belum init`);
      return;
    }
    this.server
      .to(RealtimeService.publicRoom(tenant.subdomain))
      .emit(event, toWirePublicEntry(entry));
    this.server.to(RealtimeService.staffRoom(tenant.id)).emit(event, toWireEntry(entry));
    this.server.to(RealtimeService.entryRoom(entry.id)).emit(event, toWireEntry(entry));
  }
}
