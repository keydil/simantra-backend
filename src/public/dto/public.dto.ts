import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePublicEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;
}

export class PublicEntriesQueryDto {
  /** CSV, mis. "waiting,serving" (default). */
  @IsOptional()
  @IsString()
  status?: string;
}
