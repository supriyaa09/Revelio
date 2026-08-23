/**
 * View-model helpers for the file-explorer workspace.
 *
 * The workspace presents the taxonomy as a directory tree — departments contain
 * categories, categories contain year folders, and documents are the files —
 * so these types describe *folders* and *files* rather than database rows. Pure
 * on purpose: no Supabase, no React, so the server page and the client shell
 * agree on the same shapes without either importing the other's runtime.
 */

/** Coarse file family, used to pick an icon and a tint. */
export type FileKind = 'pdf' | 'doc' | 'sheet' | 'slide' | 'image' | 'text' | 'archive' | 'other';

/** What kind of thing a folder stands for. Drives its icon and count wording. */
export type FolderKind = 'department' | 'category' | 'year';

export interface ExplorerFolder {
  /** Stable React key. */
  key: string;
  name: string;
  /** Where clicking it navigates. */
  href: string;
  /** Documents filed anywhere beneath this folder. */
  count: number;
  kind: FolderKind;
  /** Secondary line, e.g. "3 categories". Omitted when there is nothing to add. */
  hint?: string;
}

/** One hop in the location bar. The last entry is the folder being viewed. */
export interface Crumb {
  label: string;
  href: string;
}

/*
 * Extension wins over MIME type. Browsers hand us application/octet-stream for
 * plenty of ordinary uploads, and a wrong icon on a file whose name ends in
 * .pdf is the kind of small dishonesty that makes a UI feel unreliable.
 */
const BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pages: 'doc',
  xls: 'sheet',
  xlsx: 'sheet',
  csv: 'sheet',
  tsv: 'sheet',
  ods: 'sheet',
  ppt: 'slide',
  pptx: 'slide',
  odp: 'slide',
  key: 'slide',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  heic: 'image',
  txt: 'text',
  md: 'text',
  json: 'text',
  xml: 'text',
  log: 'text',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

/** Uppercase extension for the "Type" column — "PDF", "DOCX", or "" if none. */
export function fileExtension(filename: string | null | undefined): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension.
  if (dot <= 0 || dot === filename.length - 1) return '';
  const ext = filename.slice(dot + 1);
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toUpperCase() : '';
}

/** Which icon family a file belongs to, from its name first and MIME second. */
export function fileKind(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): FileKind {
  const ext = fileExtension(filename).toLowerCase();
  if (ext && BY_EXTENSION[ext]) return BY_EXTENSION[ext];

  const mime = (mimeType ?? '').toLowerCase();
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'sheet';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'slide';
  if (mime.includes('word') || mime.includes('opendocument.text')) return 'doc';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return 'archive';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}

/** "4 items" / "1 item" — folder subtitles read as counts, never as bare digits. */
export function itemCount(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/**
 * Builds a workspace URL from the level parameters, dropping the empty ones.
 *
 * Centralised so the breadcrumbs, the folder tiles, and the navigation pane
 * cannot drift into producing three slightly different links to one folder.
 */
export function workspaceHref(params: {
  dept?: string | null;
  cat?: string | null;
  year?: string | number | null;
  unfiled?: boolean;
  flat?: boolean;
}): string {
  const search = new URLSearchParams();
  if (params.unfiled) search.set('unfiled', '1');
  if (params.dept) search.set('dept', params.dept);
  if (params.cat) search.set('cat', params.cat);
  if (params.year) search.set('year', String(params.year));
  if (params.flat) search.set('flat', '1');
  const qs = search.toString();
  return qs ? `/workspace?${qs}` : '/workspace';
}
