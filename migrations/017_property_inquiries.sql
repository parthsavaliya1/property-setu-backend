-- Buyer questions sent to a property owner.

CREATE TABLE IF NOT EXISTS public.property_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  email TEXT,
  message TEXT,
  inquiry_type TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_inquiries_type_check CHECK (
    inquiry_type IS NULL OR inquiry_type IN (
      'call', 'whatsapp', 'message', 'visit', 'price_request'
    )
  ),
  CONSTRAINT property_inquiries_status_check CHECK (
    status IN ('new', 'contacted', 'interested', 'closed', 'spam')
  )
);

COMMENT ON TABLE public.property_inquiries IS
  'Contact, WhatsApp, message, visit, and price requests. The owner and the buyer can both read them.';

CREATE INDEX IF NOT EXISTS idx_property_inquiries_property_id ON public.property_inquiries (property_id);
CREATE INDEX IF NOT EXISTS idx_property_inquiries_buyer_id ON public.property_inquiries (buyer_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_inquiries;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
