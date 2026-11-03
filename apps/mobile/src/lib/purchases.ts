// Web / unsupported platforms: no store billing (iOS/Android use purchases.native.ts).

export type StorePackage = { id: string; productId: string; priceString: string; handle: unknown };

export const storeBillingAvailable = false;

export async function storePackages(_userId: string): Promise<StorePackage[]> {
  return [];
}

export async function buy(_userId: string, _pkg: StorePackage): Promise<'purchased' | 'cancelled'> {
  throw new Error('store billing is not available on this platform');
}

export async function restore(_userId: string): Promise<void> {
  throw new Error('store billing is not available on this platform');
}
