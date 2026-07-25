import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const WINDOW_MS = Number(process.env.THROTTLE_TTL_MS ?? 60000);
const PUBLIC_LIMIT = Number(process.env.THROTTLE_LIMIT ?? 100);
const STAFF_LIMIT = Number(process.env.THROTTLE_STAFF_LIMIT ?? 300);

/**
 * Bucket throttle terpisah untuk route staff (butuh JWT) vs route publik
 * (`@Public()`). Rate-limit per-IP pertahanan utamanya buat trafik ANONIM;
 * route staff sudah digerbangi JwtAuthGuard+RolesGuard, jadi limit seketat
 * publik nggak perlu dan malah nge-throttle dashboard staff yang legit
 * (insiden 429 di /dashboard & /[tenant]/admin — root cause sebenarnya
 * fan-out request & polling terlalu rapat, ditangani terpisah di frontend;
 * ini cuma naikin batas atas staff, TETAP terbatas, bukan unlimited).
 *
 * Dicek dari METADATA route (@Public()), BUKAN request.user — guard ini
 * jalan SEBELUM JwtAuthGuard di rantai APP_GUARD (app.module.ts), jadi
 * request.user belum terisi saat canActivate ini dieksekusi. Konsekuensinya:
 * penentuan bucket berdasar DESAIN route, bukan identitas TERVERIFIKASI —
 * request anonim ke route staff (tanpa token valid) juga kena bucket staff
 * yang lebih longgar sebelum akhirnya di-401 JwtAuthGuard, tapi karena tidak
 * ada kerja DB yang terjadi sebelum 401 itu, dampaknya cuma butuh lebih
 * banyak percobaan sebelum ke-throttle — bukan beban nyata ke server.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const limit = isPublic ? PUBLIC_LIMIT : STAFF_LIMIT;
    const throttler: ThrottlerOptions = { name: 'default', ttl: WINDOW_MS, limit };

    return this.handleRequest({
      context,
      limit,
      ttl: WINDOW_MS,
      throttler,
      blockDuration: WINDOW_MS,
      getTracker: this.getTracker.bind(this),
      generateKey: this.generateKey.bind(this),
    });
  }
}
