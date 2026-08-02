import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Opsional — dikirim halaman /[tenant]/login untuk memastikan akun memang
   *  milik tenant tsb (superadmin bebas). */
  @IsOptional()
  @IsString()
  tenant_slug?: string;
}

export class RefreshDto {
  /** Opsional — default diambil dari httpOnly cookie. */
  @IsOptional()
  @IsString()
  refresh_token?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  old_password!: string;

  @IsString()
  @MinLength(8)
  new_password!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordConfirmDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(8)
  new_password!: string;
}
