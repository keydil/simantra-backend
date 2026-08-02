import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.resend = new Resend(config.get<string>('RESEND_API_KEY'));
    this.from =
      config.get<string>('EMAIL_FROM') ?? 'SIMANTRA <noreply@simantra.fadhilfa.my.id>';
  }

  /**
   * Kegagalan kirim di-log & ditelan di sini, sengaja tidak dilempar ke
   * caller — forgot-password harus tetap balas sukses generik apa pun
   * hasil pengiriman email (anti-enumeration).
   */
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Reset Password SIMANTRA',
      html: passwordResetEmailHtml(resetUrl),
    });

    if (error) {
      this.logger.error(`Gagal kirim email reset password ke ${to}: ${error.message}`);
    }
  }
}

function passwordResetEmailHtml(resetUrl: string): string {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #1e3a5f;">Reset Password SIMANTRA</h2>
      <p>Kami menerima permintaan reset password untuk akun Anda. Klik tombol di bawah untuk mengatur password baru.</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}"
           style="background: #1e3a5f; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
          Reset Password
        </a>
      </p>
      <p>Link ini hanya berlaku selama 1 jam dan hanya bisa dipakai sekali. Kalau Anda tidak meminta reset password, abaikan saja email ini.</p>
      <p style="font-size: 12px; color: #6b7280; margin-top: 32px;">
        Kalau tombol di atas tidak berfungsi, salin dan buka link berikut di browser Anda:<br />
        <a href="${resetUrl}" style="color: #1e3a5f;">${resetUrl}</a>
      </p>
    </div>
  `;
}
