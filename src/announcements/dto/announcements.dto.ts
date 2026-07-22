import { AnnouncementTarget, AnnouncementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsOptional()
  @IsEnum(AnnouncementType)
  announcement_type?: AnnouncementType;

  @IsOptional()
  @IsEnum(AnnouncementTarget)
  target_tenants?: AnnouncementTarget;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  specific_tenant_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;

  @IsOptional()
  @IsEnum(AnnouncementType)
  announcement_type?: AnnouncementType;

  @IsOptional()
  @IsEnum(AnnouncementTarget)
  target_tenants?: AnnouncementTarget;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  specific_tenant_ids?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}
