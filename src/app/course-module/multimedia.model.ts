/**
 * Multimedia types, rules and pure helpers.
 * Everything here is framework-free so it can be unit-tested without TestBed.
 * Rules mirror the SRS Field List and MultimediaService on the backend (server stays authoritative).
 */

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

/** MultimediaEntity.resourceType - derived by the backend from the file extension. */
export type MultimediaKind =
  | 'VIDEO'
  | 'AUDIO'
  | 'PDF'
  | 'DOCUMENT'
  | 'PRESENTATION'
  | 'SPREADSHEET'
  | 'IMAGE'
  | 'ARCHIVE'
  | 'OTHER';

/** Mirrors MultimediaDto.MultimediaResponse. */
export interface MultimediaResource {
  id: number;
  courseId: number;
  sectionId: number;
  name: string;
  description: string | null;
  resourceType: MultimediaKind;
  fileUrl: string;
  originalFileName: string;
  fileExtension: string;
  contentType: string | null;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors MultimediaDto.MultimediaRequest (the "resource" JSON part). */
export interface MultimediaRequest {
  name: string;
  description: string | null;
}

/** Emitted by <app-multimedia-upload> after a successful save. */
export interface MultimediaSaveResult {
  resource: MultimediaResource;
  created: boolean;
}

export type UploadEvent =
  | { kind: 'progress'; percent: number }
  | { kind: 'done'; resource: MultimediaResource };

// ---------------------------------------------------------------------------
// Rules (SRS Field List)
// ---------------------------------------------------------------------------

export const RESOURCE_NAME_MIN = 4;
export const RESOURCE_NAME_MAX = 100;
export const RESOURCE_DESCRIPTION_MAX = 500;
export const FILE_NAME_MAX = 255; // multimedia_resources.original_file_name length

/** Keep in sync with app.multimedia.max-file-size-mb on the backend. */
export const MULTIMEDIA_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** The UI "Resource Type" select groups the backend's finer-grained kinds. */
export type ResourceGroup = 'VIDEO' | 'AUDIO' | 'IMAGE' | 'DOCUMENT' | 'ARCHIVE';

export const RESOURCE_GROUPS: readonly ResourceGroup[] = ['VIDEO', 'AUDIO', 'IMAGE', 'DOCUMENT', 'ARCHIVE'];

export const RESOURCE_GROUP_LABELS: Readonly<Record<ResourceGroup, string>> = {
  VIDEO: 'Video',
  AUDIO: 'Audio',
  IMAGE: 'Image',
  DOCUMENT: 'Document',
  ARCHIVE: 'Archive',
};

export const RESOURCE_GROUP_EXTENSIONS: Readonly<Record<ResourceGroup, readonly string[]>> = {
  VIDEO: ['mp4'],
  AUDIO: ['mp3'],
  IMAGE: ['jpg', 'jpeg', 'png'],
  DOCUMENT: ['pdf', 'docx', 'pptx', 'xlsx'],
  ARCHIVE: ['zip'],
};

export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(
  RESOURCE_GROUPS.flatMap(group => RESOURCE_GROUP_EXTENSIONS[group]),
);

/** Only these hosts may be embedded (iframe / media) for an already-uploaded resource. */
export const TRUSTED_MEDIA_HOSTS: readonly string[] = ['res.cloudinary.com'];

/** Exact messages MultimediaService returns for the file field (SRS Field List #3). */
export const SERVER_FILE_ERRORS: ReadonlySet<string> = new Set([
  'File is required.',
  'Unsupported file format.',
  'File size exceeds maximum limit.',
]);

/** Fragment of the backend's duplicate-name (409) message. */
export const DUPLICATE_NAME_HINT = 'same name';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 || dot === fileName.length - 1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function toResourceGroup(value: unknown): ResourceGroup | null {
  return typeof value === 'string' ? (RESOURCE_GROUPS.find(g => g === value) ?? null) : null;
}

export function groupOfExtension(ext: string): ResourceGroup | '' {
  return RESOURCE_GROUPS.find(g => RESOURCE_GROUP_EXTENSIONS[g].includes(ext)) ?? '';
}

export function groupOfKind(kind: MultimediaKind): ResourceGroup | '' {
  switch (kind) {
    case 'VIDEO':
    case 'AUDIO':
    case 'IMAGE':
    case 'ARCHIVE':
      return kind;
    case 'PDF':
    case 'DOCUMENT':
    case 'PRESENTATION':
    case 'SPREADSHEET':
      return 'DOCUMENT';
    default:
      return '';
  }
}

export function mismatchMessage(group: ResourceGroup): string {
  const allowed = RESOURCE_GROUP_EXTENSIONS[group].map(e => `.${e}`).join(', ');
  return `Unsupported file format. Allowed for ${RESOURCE_GROUP_LABELS[group]}: ${allowed}`;
}

export type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'file' | 'none';

export function previewTypeOf(ext: string): PreviewType {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
      return 'image';
    case 'mp4':
      return 'video';
    case 'mp3':
      return 'audio';
    case 'pdf':
      return 'pdf';
    default:
      return ext ? 'file' : 'none';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Same normalisation as MultimediaService.validateName on the backend. */
export function normalizeResourceName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function validateResourceName(normalized: string): string {
  if (!normalized) return 'Resource Name is required.';
  if (normalized.length < RESOURCE_NAME_MIN) return `Minimum ${RESOURCE_NAME_MIN} characters.`;
  if (normalized.length > RESOURCE_NAME_MAX) return `Maximum ${RESOURCE_NAME_MAX} characters.`;
  return '';
}

export function validateResourceDescription(raw: string): string {
  return raw.trim().length > RESOURCE_DESCRIPTION_MAX ? 'Description exceeds maximum length.' : '';
}

/** Synchronous file checks (SRS Field List #3). Returns '' when the file is acceptable. */
export function validateUploadFile(file: File, group: ResourceGroup | ''): string {
  if (file.size === 0) return 'The selected file is empty.';
  if (file.name.length > FILE_NAME_MAX) return `File name must not exceed ${FILE_NAME_MAX} characters.`;
  const ext = extensionOf(file.name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return 'Unsupported file format.';
  if (group && !RESOURCE_GROUP_EXTENSIONS[group].includes(ext)) return mismatchMessage(group);
  if (file.size > MULTIMEDIA_MAX_FILE_BYTES) return 'File size exceeds maximum limit.';
  return '';
}

/**
 * Defence in depth (OWASP file-upload guidance): a renamed file must not pass on its extension alone.
 * Checks the magic bytes for the claimed extension. Client-side only - the server must still verify.
 */
export async function matchesFileSignature(file: File, ext: string): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (offset: number, signature: readonly number[]): boolean =>
    signature.every((byte, i) => bytes[offset + i] === byte);

  switch (ext) {
    case 'pdf':
      return at(0, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'png':
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return at(0, [0xff, 0xd8, 0xff]);
    case 'zip':
    case 'docx':
    case 'pptx':
    case 'xlsx':
      return at(0, [0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (OOXML files are zip containers)
    case 'mp4':
      return at(4, [0x66, 0x74, 0x79, 0x70]); // "ftyp"
    case 'mp3':
      return at(0, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0); // ID3 or frame sync
    default:
      return false;
  }
}

/** Returns the URL only if it is https and served from an allow-listed media host. */
export function trustedMediaUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && TRUSTED_MEDIA_HOSTS.includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}