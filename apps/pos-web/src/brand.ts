/**
 * The two marks the register draws, baked into the bundle rather than fetched.
 *
 * They used to live in public/brand/ and load as /brand/*.png on every screen.
 * Two things were wrong with that. The service worker cached /assets/ and
 * /fonts/ and nothing else, so these were the only pictures in the app that
 * hit the network every single time, with no cache to fall back on. On a slow
 * or flaky connection the register loaded fine and then sat there with two
 * broken images — which is exactly what Tim saw away from the venue.
 *
 * And they were shipped at eight times the size they are drawn: a 486px mark
 * for a 30px slot, a 591px fish for a 110px one. Fifty kilobytes of PNG for
 * two small marks, re-fetched on every open.
 *
 * `?inline` makes Vite emit them as data URIs inside the hashed JS bundle, so
 * they are covered by the same cache-first rule as the rest of the app and
 * there is no separate request that can fail. Resized to 2x their largest
 * drawn size first, which is why that is affordable: 49.5 KB of PNG became
 * 16 KB, and nothing on screen changes.
 *
 * public/brand/ still holds the originals — the PWA manifest icons and the
 * terminal idle screens are loaded by the browser, not by this bundle. The
 * worker now caches /brand/ too, so those survive an outage as well; this
 * file is the belt, that is the braces.
 */
import almaMarkUrl from './brand/alma-a-mark.png?inline';
import almaFishUrl from './brand/alma-fish.png?inline';

export const ALMA_MARK = almaMarkUrl;
export const ALMA_FISH = almaFishUrl;
