import { post, uploadToPresigned } from '../api/client';

export interface UploadedFile {
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Flujo de subida: pide URL prefirmada al API, sube a S3 y devuelve los metadatos para registrar. */
export async function uploadFile(uploadUrlPath: string, file: File): Promise<UploadedFile> {
  const meta = { fileName: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size };
  const { uploadUrl, fileKey } = await post<{ uploadUrl: string; fileKey: string }>(uploadUrlPath, meta);
  await uploadToPresigned(uploadUrl, file);
  return { fileKey, ...meta };
}
