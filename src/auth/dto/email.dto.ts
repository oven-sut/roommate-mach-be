import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class EmailDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  @Transform(normalizeEmail)
  email: string;
}

export class VerifyOtpDto extends EmailDto {
  /** The app sends `otp`; `code` is accepted as an alias. */
  @IsOptional()
  @IsString()
  @Length(4, 8)
  otp?: string;

  @IsOptional()
  @IsString()
  @Length(4, 8)
  code?: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(16, { message: 'Reset token is invalid or expired' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}

export class ResetPasswordOtpDto extends EmailDto {
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  password: string;
}
