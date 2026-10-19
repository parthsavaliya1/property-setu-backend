import { z } from "zod";
import { asyncRoute } from "../http.js";
import { billingAccountId, billingConfigured, creditPacks, verifyAndCreditPlayPurchase } from "../services/playBilling.js";

export const PlayBillingController = {
  products: asyncRoute(async (req, res) => {
    res.json({ configured: billingConfigured(), account_id: billingAccountId(req.user!.id), products: creditPacks });
  }),
  verify: asyncRoute(async (req, res) => {
    const body = z.object({ product_id: z.string().max(200), purchase_token: z.string().min(10).max(4096) }).parse(req.body);
    res.json(await verifyAndCreditPlayPurchase(req.user!.id, body.product_id, body.purchase_token));
  }),
};
