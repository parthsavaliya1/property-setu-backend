import { listingSettings } from "./appSettings.js";

type ListingFees = { standard: number; premium: number };

/** Charged monthly fees from the admin Settings tab. */
export async function listingFees(): Promise<ListingFees> {
  const settings = await listingSettings();
  return { standard: settings.standardPrice, premium: settings.premiumPrice };
}
