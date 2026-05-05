import { ProductLogo } from '@alma/ui';

/**
 * Stock-specific sidebar brand. Mirrors the default AppShell brand while
 * using the shared Stock product identity.
 */
export function StockBrand() {
  return (
    <ProductLogo appId="stock" size="md" showBrandMark={false} />
  );
}
