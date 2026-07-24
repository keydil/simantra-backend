import { randomUUID } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import type { Request } from 'express';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export const ALLOWED_IMAGE_MIMES = Object.keys(MIME_EXT);
export const ALLOWED_VIDEO_MIMES = Object.keys(VIDEO_MIME_EXT);
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB (logo & foto tamu)
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB (video signage E7)

/** Semua prefix folder di dalam /uploads. */
export type UploadPrefix = 'guest-photos' | 'tenant-logos' | 'tenant-videos';

/**
 * Resolusi direktori upload — DISALIN dari cara StorageService membacanya,
 * karena multer diskStorage untuk video dikonfigurasi saat decorator dievaluasi
 * (class-load), jauh sebelum DI tersedia, jadi tidak bisa inject StorageService.
 * Tetap satu sumber env var yang sama (STORAGE_LOCAL_DIR).
 */
function resolveLocalDir(): string {
  return resolve(process.env.STORAGE_LOCAL_DIR ?? './uploads');
}

/**
 * Engine multer untuk upload VIDEO (E7). Beda dari logo yang pakai
 * memoryStorage: video bisa puluhan MB, jadi di-STREAM langsung ke disk
 * (tidak menahan seluruh file di RAM). fileFilter menolak tipe non-video
 * SEBELUM ditulis, jadi filename callback aman berasumsi mime valid.
 */
export function videoDiskStorage() {
  return diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb) => {
      const dir = join(resolveLocalDir(), 'tenant-videos');
      mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err) => cb(err as Error, dir));
    },
    filename: (_req: Request, file: Express.Multer.File, cb) => {
      const ext = VIDEO_MIME_EXT[file.mimetype];
      cb(null, `${randomUUID()}.${ext}`);
    },
  });
}

export function videoFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) {
  if (!ALLOWED_VIDEO_MIMES.includes(file.mimetype)) {
    return cb(new BadRequestException('Tipe file tidak didukung (hanya MP4/WebM)'), false);
  }
  cb(null, true);
}

/**
 * Storage adapter (§3.3 DESIGN.md) — pengganti Supabase Storage. Driver
 * `local` untuk dev (disajikan via /uploads static); driver S3-compatible
 * menyusul saat deploy produksi. URL foto SELALU buatan server — client
 * tidak pernah menentukan URL bebas (L2), jadi regex anchoring script 08
 * tidak dibutuhkan lagi.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly driver: string;
  private readonly localDir: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('STORAGE_DRIVER') ?? 'local';
    this.localDir = resolve(config.get<string>('STORAGE_LOCAL_DIR') ?? './uploads');
    this.baseUrl = (config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3002').replace(/\/$/, '');
  }

  async onModuleInit() {
    if (this.driver === 'local') {
      await mkdir(this.localDir, { recursive: true });
    }
  }

  get staticRoot() {
    return this.localDir;
  }

  async saveImage(buffer: Buffer, mime: string, prefix: 'guest-photos' | 'tenant-logos') {
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw new BadRequestException(`Tipe file tidak didukung: ${mime} (hanya JPEG/PNG/WebP)`);
    }
    if (this.driver !== 'local') {
      throw new Error(`Driver storage '${this.driver}' belum dikonfigurasi`);
    }

    const filename = `${randomUUID()}.${ext}`;
    const dir = join(this.localDir, prefix);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);

    return { url: `${this.baseUrl}/uploads/${prefix}/${filename}` };
  }

  /**
   * URL publik untuk file video yang SUDAH ditulis multer diskStorage ke
   * folder tenant-videos (lihat videoDiskStorage). Server tetap pemilik
   * tunggal pembentukan URL — client cuma mengirim file, bukan URL.
   */
  videoUrl(filename: string) {
    return `${this.baseUrl}/uploads/tenant-videos/${filename}`;
  }

  /** Validasi photo_url guest book berasal dari storage kita sendiri
   *  (padanan anchored-regex script 08). */
  isOwnUploadUrl(url: string, prefix: UploadPrefix) {
    return url.startsWith(`${this.baseUrl}/uploads/${prefix}/`);
  }

  /**
   * Hapus file yang tadinya dirujuk sebuah URL. Dipakai saat hard delete
   * tenant: cascade Prisma menghapus baris DB tapi tidak menyentuh disk, jadi
   * tanpa ini tiap penghapusan meninggalkan foto & logo yatim selamanya.
   *
   * Sengaja memaafkan (tidak melempar) untuk semua kasus "bukan urusan kita":
   * URL kosong, URL milik host lain (mis. logo diarahkan ke CDN luar — bukan
   * hak kita menghapusnya), atau file yang memang sudah tidak ada.
   */
  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;
    if (this.driver !== 'local') return;

    const prefix = (['guest-photos', 'tenant-logos', 'tenant-videos'] as const).find((p) =>
      this.isOwnUploadUrl(url, p),
    );
    if (!prefix) return;

    const filename = url.slice(`${this.baseUrl}/uploads/${prefix}/`.length);
    // Nama file dihasilkan server sebagai UUID polos. Apa pun yang mengandung
    // pemisah path berarti URL sudah dirusak — tolak, jangan coba dibersihkan.
    if (!filename || /[\\/]/.test(filename) || filename.includes('..')) return;

    const target = resolve(join(this.localDir, prefix, filename));
    // Sabuk pengaman kedua: apa pun yang terjadi di atas, jangan pernah
    // menghapus di luar direktori upload.
    if (!target.startsWith(resolve(this.localDir))) return;

    await rm(target, { force: true });
  }
}
