import type { MenuDocument, MenuKind, MenuVisibility } from '@alma/shared';

/**
 * One menu the importer may create from a reference document (a PDF from the
 * design folder, a sheet from the website repo). Imports are repeatable: the
 * importer finds an existing menu by (venueSlug, slug) and never creates a
 * second one, never overwrites a draft somebody has edited, and never
 * publishes — every imported menu is a reviewable draft, with an audit row
 * naming the source and how sure we are that it is current.
 */
export type MenuImportSource = {
  /** Where the content came from: a Dropbox path, a website repo path, a URL. */
  path: string;
  /** Dropbox file id, git commit, or other durable reference. */
  ref?: string;
  /** Content hash of the source where known. */
  hash?: string;
  /** When the source was last modified, ISO. */
  modifiedAt?: string;
  /** What this was checked against and why the confidence is what it is. */
  notes: string;
};

export type MenuImportConfidence = 'high' | 'medium' | 'low';

export type MenuImportSpec = {
  /** The venue that owns the menu (group documents are owned by one venue and print both marks). */
  venueSlug: string;
  kind: MenuKind;
  templateKey: string;
  /** The name on the Menus home; the slug is what the website links. */
  name: string;
  slug: string;
  visibility?: MenuVisibility;
  confidence: MenuImportConfidence;
  source: MenuImportSource;
  /** Things the owner should check before publishing (prices, hours, wording). */
  review: string[];
  document: MenuDocument;
};
