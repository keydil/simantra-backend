import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthUser, JwtPayload } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

interface JoinPayload {
  type: 'tenant_public' | 'entry' | 'staff';
  /** utk tenant_public */
  slug?: string;
  /** utk entry */
  entry_id?: string;
  /** utk staff — hanya dipakai superadmin (staff biasa dipaksa tenant sendiri) */
  tenant_id?: string;
}

@WebSocketGateway({
  namespace: '/realtime',
  // .trim() sama seperti CORS REST di main.ts — Socket.IO default-nya
  // polling dulu (XHR lintas origin), jadi CORS salah = socket tidak pernah
  // nyambung dan frontend diam-diam turun ke polling tanpa pesan error.
  cors: { origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true, credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  afterInit(server: Server) {
    this.realtime.setServer(server);
    this.logger.log('Realtime gateway siap (namespace /realtime)');
  }

  /** Token opsional di handshake — koneksi anon tetap diterima, tapi hanya
   *  bisa join room publik/entry. Token invalid = diperlakukan anon. */
  handleConnection(client: Socket) {
    const token: string | undefined = client.handshake.auth?.token;
    if (!token) return;
    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      const user: AuthUser = {
        id: payload.sub,
        role: payload.role,
        tenantId: payload.tenant_id,
        tenantSlug: payload.tenant_slug,
        mustChangePassword: payload.must_change_password,
      };
      client.data.user = user;
    } catch {
      // biarkan anon
    }
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() payload: JoinPayload) {
    try {
      const room = await this.resolveRoom(client, payload ?? ({} as JoinPayload));
      await client.join(room);
      return { ok: true, room };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Join ditolak' };
    }
  }

  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody() payload: { room?: string }) {
    if (payload?.room) await client.leave(payload.room);
    return { ok: true };
  }

  /** Validasi join = kontrak scoping yang sama dengan REST publik (§5.1). */
  private async resolveRoom(client: Socket, payload: JoinPayload): Promise<string> {
    switch (payload.type) {
      case 'tenant_public': {
        if (!payload.slug) throw new Error('slug wajib diisi');
        const tenant = await this.prisma.tenant.findFirst({
          where: { subdomain: payload.slug, isActive: true },
          select: { subdomain: true },
        });
        if (!tenant) throw new Error('Tenant tidak ditemukan atau tidak aktif');
        return RealtimeService.publicRoom(tenant.subdomain);
      }
      case 'entry': {
        if (!payload.entry_id) throw new Error('entry_id wajib diisi');
        const entry = await this.prisma.queueEntry.findFirst({
          where: { id: payload.entry_id, tenant: { isActive: true } },
          select: { id: true },
        });
        if (!entry) throw new Error('Tiket tidak ditemukan');
        return RealtimeService.entryRoom(entry.id);
      }
      case 'staff': {
        const user: AuthUser | undefined = client.data.user;
        if (!user) throw new Error('Butuh login untuk room staff');
        if (user.role === 'superadmin') {
          const tenantId = payload.tenant_id ?? user.tenantId;
          if (!tenantId) throw new Error('tenant_id wajib diisi untuk superadmin');
          return RealtimeService.staffRoom(tenantId);
        }
        if (!user.tenantId) throw new Error('Akun tidak terikat tenant');
        return RealtimeService.staffRoom(user.tenantId);
      }
      default:
        throw new Error('Tipe room tidak dikenal');
    }
  }
}
