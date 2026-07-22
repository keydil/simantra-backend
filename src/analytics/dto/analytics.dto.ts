import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AnalyticsRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class QueueAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class AggregateDto {
  /** Tanggal (YYYY-MM-DD) yang diagregasi; default = kemarin. */
  @IsOptional()
  @IsDateString()
  date?: string;

  /**
   * Backfill N hari terakhir (termasuk hari ini) sekaligus. Dipakai tombol
   * "Perbarui data analitik" — cron cuma mengisi kemarin, jadi data historis
   * & environment yang cron-nya belum pernah nyala butuh ini. Idempoten.
   * Diprioritaskan di atas `date` kalau dua-duanya dikirim.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
}
