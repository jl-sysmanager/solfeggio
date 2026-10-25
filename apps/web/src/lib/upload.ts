import { ApiError, post, uploadToPresigned } from '../api/client';

export interface UploadedFile {
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Cuando el navegador deja `file.type` vacío (PDF en Safari/macOS, MusicXML, etc.). */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  xml: 'application/xml',
  musicxml: 'application/vnd.recordare.musicxml+xml',
  mxl: 'application/vnd.recordare.musicxml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

export function mimeOf(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  return EXT_MIME[ext] ?? (file.type || 'application/octet-stream');
}

/** Flujo de subida: pide URL prefirmada al API, sube a S3 y devuelve los metadatos para registrar. */
export async function uploadFile(uploadUrlPath: string, file: File): Promise<UploadedFile> {
  const meta = { fileName: file.name, mimeType: mimeOf(file), sizeBytes: file.size };
  const { uploadUrl, fileKey } = await post<{ uploadUrl: string; fileKey: string }>(uploadUrlPath, meta);
  try {
    await uploadToPresigned(uploadUrl, file, meta.mimeType);
  } catch (e) {
    if (e instanceof TypeError) {
      let host = '';
      try {
        host = new URL(uploadUrl).origin;
      } catch {
        /* ignore */
      }
      throw new ApiError(
        0,
        host
          ? `No se pudo subir el fichero (failed to fetch) hacia ${host}. En web, S3_ORIGIN debe incluir ese origen (p. ej. https://*.t3.storageapi.dev https://t3.storageapi.dev). En api, APP_URL/CORS_ORIGINS = dominio de la web y redespliega api.`
          : 'No se pudo subir el fichero (failed to fetch). Suele ser CORS del bucket o CSP (S3_ORIGIN en web; APP_URL/CORS_ORIGINS en api).',
      );
    }
    throw e;
  }
  return { fileKey, ...meta };
}
