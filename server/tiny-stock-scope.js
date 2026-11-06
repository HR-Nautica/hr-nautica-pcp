export const TINY_SCOPES = ['all', 'helices', 'brutos', 'buchas', 'componentes'];
export function productInTinyScope(product, scope = 'all') {
  if (scope === 'all') return true;
  if (scope === 'helices') return product.item_type === 'Hélice usinada';
  if (scope === 'brutos') return product.item_type === 'Hélice bruta';
  if (scope === 'buchas') return product.item_type === 'Bucha';
  return product.family === 'componentes' && !['Hélice usinada', 'Hélice bruta', 'Bucha'].includes(product.item_type);
}
