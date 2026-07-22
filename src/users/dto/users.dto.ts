import { Role } from '@prisma/client';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  /** Password awal pilihan admin — user dipaksa menggantinya di login pertama
   *  (must_change_password), sesuai alur script 13 project lama. */
  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @IsEnum(Role)
  role!: Role;

  /** Wajib utk role non-superadmin bila caller superadmin; diabaikan (dipaksa
   *  tenant sendiri) bila caller admin. */
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  new_password!: string;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  is_active?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
