-- These tables were created after 030_rls.sql granted access to existing tables.
-- Keep wallet writes in the trusted payment service; clients only read their
-- own records through the existing authenticated SELECT policies in 034.
GRANT SELECT ON TABLE public.wallets, public.wallet_transactions TO authenticated;
