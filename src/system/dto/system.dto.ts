import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMaintenanceDto {
  @IsBoolean()
  active!: boolean;

  /** Pesan custom yang ditampilkan di layar pemeliharaan. Opsional — kalau
   *  kosong, frontend memakai pesan default. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
