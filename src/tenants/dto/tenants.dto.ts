import { SubscriptionTier, TenantDisplayBackgroundMode, TenantHeaderMode } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// Daftar font judul/subtitle kiosk. STRING tervalidasi (bukan enum Prisma)
// SENGAJA — nambah font baru nanti murni ubah array ini + tambah import
// next/font di frontend, TANPA migrasi database. Array ini diduplikasi
// manual di frontend (lib/theme/header-fonts.ts) karena dua repo terpisah
// tak bisa saling import — kalau menambah/mengubah nama key di sini, ubah
// juga di sana.
export const HEADER_FONT_KEYS = [
  'default',
  'montserrat',
  'poppins',
  'inter',
  'pt_serif',
  'playfair_display',
  'comic_neue',
  'patrick_hand',
] as const;

// Preset ukuran subtitle kiosk. Duplikasi manual di frontend
// (lib/theme/header-fonts.ts) — sama seperti HEADER_FONT_KEYS di atas.
export const HEADER_SUBTITLE_SIZES = ['sm', 'md', 'lg'] as const;

export class CreateTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'subdomain hanya boleh huruf kecil, angka, dan tanda hubung',
  })
  @MaxLength(255)
  subdomain!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logo_url?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  brand_color?: string;

  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscription_tier?: SubscriptionTier;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'subdomain hanya boleh huruf kecil, angka, dan tanda hubung',
  })
  @MaxLength(255)
  subdomain?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logo_url?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  brand_color?: string;

  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscription_tier?: SubscriptionTier;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateThemeDto {
  @IsOptional() @Matches(HEX_COLOR) primary_color?: string;
  @IsOptional() @Matches(HEX_COLOR) secondary_color?: string;
  @IsOptional() @Matches(HEX_COLOR) accent_color?: string;
  @IsOptional() @Matches(HEX_COLOR) text_color?: string;
  @IsOptional() @Matches(HEX_COLOR) background_color?: string;
  @IsOptional() @IsString() @MaxLength(512) logo_url?: string;
  @IsOptional() @IsString() @MaxLength(512) favicon_url?: string;
  @IsOptional() @IsString() custom_css?: string;
  @IsOptional() @IsBoolean() is_custom_theme?: boolean;
  // header_wordmark_url SENGAJA tak ada di sini — sama seperti video_url/
  // image_url, hanya pernah di-set lewat endpoint upload, tak pernah
  // diterima sebagai URL mentah dari client.
  @IsOptional() @IsEnum(TenantHeaderMode) header_mode?: TenantHeaderMode;

  // display_background_url SENGAJA tak ada di sini — sama seperti
  // header_wordmark_url: hanya pernah di-set lewat endpoint upload, tak pernah
  // diterima sebagai URL mentah dari client.
  @IsOptional() @IsEnum(TenantDisplayBackgroundMode) display_background_mode?: TenantDisplayBackgroundMode;

  // Tipografi mode 'generated'. Judul TETAP ikut tenant.name — tak ada field
  // "header_title_text" di sini secara sengaja (lihat schema.prisma).
  @IsOptional() @IsIn(HEADER_FONT_KEYS) header_title_font?: string;
  @IsOptional() @IsBoolean() header_title_bold?: boolean;
  // "" dikirim untuk mengosongkan → service menyimpannya sebagai null,
  // kiosk fallback ke teks default (pola sama dengan running_text).
  @IsOptional() @IsString() @MaxLength(100) header_subtitle_text?: string;
  @IsOptional() @IsIn(HEADER_FONT_KEYS) header_subtitle_font?: string;
  @IsOptional() @IsBoolean() header_subtitle_bold?: boolean;
  // Ukuran preset (bukan px bebas) — konsisten dengan gaya pilihan font di
  // atas. Warna SENGAJA field terpisah dari text_color (keputusan eksplisit),
  // walau text_color sendiri belum dipakai di kiosk mana pun.
  @IsOptional() @IsIn(HEADER_SUBTITLE_SIZES) header_subtitle_size?: string;
  @IsOptional() @Matches(HEX_COLOR) header_subtitle_color?: string;
}

export class UpdateDisplayConfigDto {
  @IsOptional() @IsInt() @Min(5) @Max(600) queue_view_seconds?: number;
  @IsOptional() @IsInt() @Min(5) @Max(600) media_view_seconds?: number;
}

export class UpdateRunningTextDto {
  // String biasa (bukan optional): kirim "" untuk mengosongkan → service
  // menyimpannya sebagai null sehingga display kembali ke teks default.
  @IsString()
  @MaxLength(500)
  running_text!: string;
}

export class ListTenantsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  is_active?: string;
}
