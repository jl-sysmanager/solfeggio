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
      throw new ApiError(0, 'No se pudo subir el fichero al almacenamiento (CORS o red). Comprueba S3 y vuelve a intentarlo.');
    }
    throw e;
  }
  return { fileKey, ...meta };
}
