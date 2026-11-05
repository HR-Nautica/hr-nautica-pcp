export const TINY_IMPORT_FIELDS=['expected_outgoing_quantity','physical_quantity','period_outgoing_quantity','monthly_average'];
export function tinyImportFields(product){const configured=product?.source_metadata?.tinyImportFields;return Array.isArray(configured)?configured.filter(key=>TINY_IMPORT_FIELDS.includes(key)):(product?.tiny_import_enabled?[...TINY_IMPORT_FIELDS]:[]);}
