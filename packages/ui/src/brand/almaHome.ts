/**
 * Alma Suite Home. The one place a person lands when they are not inside a
 * particular app — the launcher, the daily brief, the door back in. Signing out
 * of any app returns here rather than to that app's own login screen, so the
 * suite behaves like one product instead of nine separate sites.
 *
 * Its own module, importing nothing: a sign-out button and a top bar should not
 * have to pull in the whole app catalogue to know one URL, and a constant with
 * no dependencies can never be the far side of an import cycle.
 */
export const ALMA_HOME_URL = 'https://alma-home.web.app';
