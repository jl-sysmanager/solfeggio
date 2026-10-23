import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { readLogo } from './logo';

function req(body: Buffer): Request {
  return { body, readableEnded: true } as Request;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('readLogo', () => {
  it('acepta un PNG', async () => {
    const logo = await readLogo(req(PNG));
    expect(logo.mime).toBe('image/png');
    expect(logo.buf).toBe(PNG);
  });

  it('rechaza un archivo que no es imagen', async () => {
    await expect(readLogo(req(Buffer.from('<html></html>')))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un cuerpo vacío', async () => {
    await expect(readLogo(req(Buffer.alloc(0)))).rejects.toBeInstanceOf(BadRequestException);
  });
});
