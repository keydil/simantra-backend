import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateVisitPurposeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;
}

export class UpdateVisitPurposeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
