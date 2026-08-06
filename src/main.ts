import { resolve } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  // Di belakang proxy platform (Railway/Vercel) semua request terlihat datang
  // dari satu IP proxy. Tanpa ini req.ip salah, sehingga throttler mem-bucket
  // SEMUA pengguna jadi satu (satu peminta abusif ikut mengunci yang lain) dan
  // metadata IP di audit login jadi tidak berguna.
  app.set('trust proxy', 1);
  // Railway mengirim SIGTERM saat redeploy — tanpa ini PrismaService
  // .onModuleDestroy tidak pernah jalan dan koneksi DB ditinggal menggantung.
  app.enableShutdownHooks();
  // File upload (foto guest book, logo tenant) — di luar prefix API
  app.use(
    '/uploads',
    express.static(resolve(process.env.STORAGE_LOCAL_DIR ?? './uploads')),
  );
  app.enableCors({
    // .trim(): "a.com, b.com" (dengan spasi setelah koma) kalau tidak
    // di-trim menghasilkan origin " b.com" yang tidak akan pernah cocok.
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true,
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`SIMANTRA backend listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
