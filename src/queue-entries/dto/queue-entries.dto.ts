import { QueueEntryStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListEntriesQueryDto {
  /** CSV, mis. "waiting,serving" (default). */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  queue_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsDateString()
  since?: string;
}

export class CallNextDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  service_window?: number;
}

export class UpdateEntryStatusDto {
  @IsEnum(QueueEntryStatus)
  status!: QueueEntryStatus;
}

export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  service_window?: number;
}
