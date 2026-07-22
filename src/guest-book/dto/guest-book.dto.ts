import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Batas panjang = WITH CHECK scripts/08-tighten-guest-book-insert.sql. */
export class CreateGuestBookDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  institution!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  purpose!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone!: string;

  /** Harus URL hasil upload endpoint foto kita sendiri — divalidasi service. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  photo_url?: string;
}

export class ListGuestBookQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class InstitutionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
