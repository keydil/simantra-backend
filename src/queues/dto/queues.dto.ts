import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export class CreateQueueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  service_code?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  color_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimated_service_time_minutes?: number;
}

export class UpdateQueueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  service_code?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  color_code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_capacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimated_service_time_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ListQueuesQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  is_active?: string;
}
