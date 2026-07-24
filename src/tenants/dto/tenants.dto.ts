import { SubscriptionTier } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

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
