import type { SalePrice } from './steam.js';

export function createSaleKey(price: SalePrice): string {
  if (price.currency === null || price.currency.trim() === '') {
    throw new Error('A sale key requires a currency');
  }

  return [
    price.currency,
    price.initialMinor,
    price.finalMinor,
    price.discountPercent,
  ].join(':');
}
