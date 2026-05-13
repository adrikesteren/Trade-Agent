/** Match canonical UUID (version nibble 1–8) for `/assets/{uuid}` backwards compatibility. */
const CATALOG_ASSET_DETAIL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCatalogAssetDetailRouteUuid(raw: string): boolean {
  return CATALOG_ASSET_DETAIL_UUID_RE.test(raw.trim());
}

export function normalizeCatalogAssetRouteSlug(raw: string): string {
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}
