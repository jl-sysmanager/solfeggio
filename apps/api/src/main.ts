import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { env } from './config/env';

async function main() {
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  configureApp(app);
  await app.listen(env().PORT, '0.0.0.0');
}

void main();
