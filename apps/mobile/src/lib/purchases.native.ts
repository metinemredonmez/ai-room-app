import { Platform } from 'react-native';
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';

import type { StorePackage } from './purchases';

// RevenueCat public SDK keys (safe in the app bundle). The entitlement itself is granted server-side
// from the signed RevenueCat webhook / REST sync — the app never decides PRO on its own.
const KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
});

let configuredFor: string | null = null;

export const storeBillingAvailable = Boolean(KEY);

/** The RevenueCat app user id is our user id, so webhooks map straight to accounts. */
async function ensure(userId: string) {
  if (!KEY) throw new Error('store billing not configured');
  if (configuredFor === null) {
    Purchases.configure({ apiKey: KEY, appUserID: userId });
    configuredFor = userId;
  } else if (configuredFor !== userId) {
    await Purchases.logIn(userId);
    configuredFor = userId;
  }
}

export async function storePackages(userId: string): Promise<StorePackage[]> {
  await ensure(userId);
  const offerings = await Purchases.getOfferings();
  return (offerings.current?.availablePackages ?? []).map((p: PurchasesPackage) => ({
    id: p.identifier,
    productId: p.product.identifier,
    priceString: p.product.priceString,
    handle: p,
  }));
}

export async function buy(userId: string, pkg: StorePackage): Promise<'purchased' | 'cancelled'> {
  await ensure(userId);
  try {
    await Purchases.purchasePackage(pkg.handle as PurchasesPackage);
    return 'purchased';
  } catch (e) {
    const err = e as { userCancelled?: boolean; code?: string };
    if (err.userCancelled || err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
    throw e;
  }
}

export async function restore(userId: string): Promise<void> {
  await ensure(userId);
  await Purchases.restorePurchases();
}
