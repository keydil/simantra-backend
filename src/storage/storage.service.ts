import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
export type UploadPrefix = 'guest-photos' | 'tenant-logos' | 'tenant-videos' | 'tenant-display' | 'sponsor-logos' | 'tenant-wordmarks' | 'tenant-display-bg';

const ALL_PREFIXES = [
  'guest-photos',
  'tenant-logos',
  'tenant-videos',
  'tenant-display',
  'sponsor-logos',
  'tenant-wordmarks',
  'tenant-display-bg',
] as const;

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
 *
 * Pada driver r2 disk ini cuma STAGING sementara — commitVideo() yang
 * memindahkannya ke bucket lalu menghapus file lokalnya.
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
 * Storage adapter (§3.3 DESIGN.md) — pengganti Supabase Storage.
 *
 *   driver `local` → tulis ke disk, disajikan via /uploads static (dev)
 *   driver `r2`    → Cloudflare R2 lewat API S3-compatible (produksi)
 *
 * Filesystem Railway bersifat ephemeral: tanpa driver r2, semua unggahan
 * hilang tiap redeploy sementara baris DB tetap menunjuk URL yang sudah 404.
 *
 * URL SELALU buatan server — client tidak pernah menentukan URL bebas (L2),
 * jadi regex anchoring script 08 tidak dibutuhkan lagi. Bentuk URL dibikin
 * seragam antar driver (`{urlRoot}/{prefix}/{filename}`) supaya percabangan
 * driver cuma ada di satu tempat: getter urlRoot.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: string;
  private readonly localDir: string;
  private readonly baseUrl: string;
  private readonly r2PublicBase: string;
  private readonly r2Bucket: string;
  private readonly s3: S3Client | null = null;

  constructor(config: ConfigService) {
    this.driver = config.get<string>('STORAGE_DRIVER') ?? 'local';
    this.localDir = resolve(config.get<string>('STORAGE_LOCAL_DIR') ?? './uploads');
    this.baseUrl = (config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3002').replace(/\/$/, '');
    this.r2PublicBase = (config.get<string>('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');
    this.r2Bucket = config.get<string>('R2_BUCKET') ?? '';

    if (this.driver === 'r2') {
      const accountId = config.get<string>('R2_ACCOUNT_ID');
      const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
      const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
      // Gagal cepat saat boot — jauh lebih mudah didiagnosis daripada 500
      // misterius saat admin mengunggah logo pertama kali.
      if (!accountId || !accessKeyId || !secretAccessKey || !this.r2Bucket || !this.r2PublicBase) {
        throw new Error(
          'STORAGE_DRIVER=r2 tapi R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL belum lengkap',
        );
      }
      this.s3 = new S3Client({
        region: 'auto', // R2 selalu 'auto'
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else if (this.driver !== 'local') {
      throw new Error(`STORAGE_DRIVER '${this.driver}' tidak dikenal (pilihan: local, r2)`);
    }
  }

  async onModuleInit() {
    if (this.driver === 'local') {
      await mkdir(this.localDir, { recursive: true });
    }
  }

  /** Akar URL publik — SATU-SATUNYA tempat bentuk URL bercabang per driver. */
  private get urlRoot() {
    return this.driver === 'r2' ? this.r2PublicBase : `${this.baseUrl}/uploads`;
  }

  async saveImage(buffer: Buffer, mime: string, prefix: 'guest-photos' | 'tenant-logos' | 'tenant-display' | 'sponsor-logos' | 'tenant-wordmarks' | 'tenant-display-bg') {
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw new BadRequestException(`Tipe file tidak didukung: ${mime} (hanya JPEG/PNG/WebP)`);
    }

    const filename = `${randomUUID()}.${ext}`;

    if (this.driver === 'r2') {
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.r2Bucket,
          Key: `${prefix}/${filename}`,
          Body: buffer,
          // Wajib: tanpa ini R2 menyajikan octet-stream dan browser
          // mengunduh file alih-alih menampilkannya di <img>.
          ContentType: mime,
        }),
      );
    } else {
      const dir = join(this.localDir, prefix);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), buffer);
    }

    return { url: `${this.urlRoot}/${prefix}/${filename}` };
  }

  /**
   * URL publik untuk file video yang SUDAH ditulis multer diskStorage ke
   * folder tenant-videos (lihat videoDiskStorage). Server tetap pemilik
   * tunggal pembentukan URL — client cuma mengirim file, bukan URL.
   */
  videoUrl(filename: string) {
    return `${this.urlRoot}/tenant-videos/${filename}`;
  }

  /**
   * Finalisasi upload video. Pada driver local file sudah berada di tempat
   * yang benar sejak multer menulisnya, jadi ini cuma membentuk URL. Pada
   * driver r2, file staging di disk dipindahkan ke bucket lalu dihapus.
   *
   * Dipisah dari videoDiskStorage karena engine multer dievaluasi saat
   * class-load (sebelum DI ada) sehingga tidak mungkin menulis langsung ke R2
   * dari sana — staging ke disk dulu jauh lebih sederhana dan tetap aman
   * karena disk Railway memang cuma dipakai sesaat di sini.
   */
  async commitVideo(filename: string): Promise<string> {
    const url = this.videoUrl(filename);
    if (this.driver !== 'r2') return url;

    const staged = join(this.localDir, 'tenant-videos', filename);
    const ext = filename.split('.').pop() ?? '';
    const mime = ext === 'webm' ? 'video/webm' : 'video/mp4';

    try {
      const { size } = await stat(staged);
      await this.s3!.send(
        new PutObjectCommand({
          Bucket: this.r2Bucket,
          Key: `tenant-videos/${filename}`,
          // Stream, bukan buffer: video sampai 50 MB tidak perlu ditahan
          // seluruhnya di RAM. ContentLength wajib saat Body berupa stream.
          Body: createReadStream(staged),
          ContentLength: size,
          ContentType: mime,
        }),
      );
    } finally {
      // Staging selalu dibersihkan, sukses maupun gagal — kalau tidak, disk
      // container pelan-pelan penuh oleh video yang gagal terunggah.
      await rm(staged, { force: true });
    }

    return url;
  }

  /** Validasi photo_url guest book berasal dari storage kita sendiri
   *  (padanan anchored-regex script 08). */
  isOwnUploadUrl(url: string, prefix: UploadPrefix) {
    return url.startsWith(`${this.urlRoot}/${prefix}/`);
  }

  /**
   * Hapus file yang tadinya dirujuk sebuah URL. Dipakai saat hard delete
   * tenant: cascade Prisma menghapus baris DB tapi tidak menyentuh storage,
   * jadi tanpa ini tiap penghapusan meninggalkan foto & logo yatim selamanya.
   *
   * Sengaja memaafkan (tidak melempar) untuk semua kasus "bukan urusan kita":
   * URL kosong, URL milik host lain (mis. logo diarahkan ke CDN luar — bukan
   * hak kita menghapusnya), atau file yang memang sudah tidak ada.
   */
  async deleteByUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;

    const prefix = ALL_PREFIXES.find((p) => this.isOwnUploadUrl(url, p));
    if (!prefix) return;

    const filename = url.slice(`${this.urlRoot}/${prefix}/`.length);
    // Nama file dihasilkan server sebagai UUID polos. Apa pun yang mengandung
    // pemisah path berarti URL sudah dirusak — tolak, jangan coba dibersihkan.
    if (!filename || /[\\/]/.test(filename) || filename.includes('..')) return;

    if (this.driver === 'r2') {
      try {
        await this.s3!.send(
          new DeleteObjectCommand({ Bucket: this.r2Bucket, Key: `${prefix}/${filename}` }),
        );
      } catch (err) {
        // Konsisten dengan semangat method ini: gagal hapus di storage tidak
        // boleh menggagalkan operasi DB yang sudah berhasil.
        this.logger.warn(`Gagal hapus objek R2 ${prefix}/${filename}: ${(err as Error).message}`);
      }
      return;
    }

    const target = resolve(join(this.localDir, prefix, filename));
    // Sabuk pengaman kedua: apa pun yang terjadi di atas, jangan pernah
    // menghapus di luar direktori upload.
    if (!target.startsWith(resolve(this.localDir))) return;

    await rm(target, { force: true });
  }
}
