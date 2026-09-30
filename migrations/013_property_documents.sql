-- Private ownership papers. Readable by the owner and admins, not by the public.

CREATE TABLE IF NOT EXISTS public.property_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_documents_type_check CHECK (
    document_type IN (
      'sale_deed',
      '7_12',
      'property_card',
      'na_order',
      'tax_receipt',
      'rera_certificate',
      'ownership_proof',
      'building_permission',
      'other'
    )
  ),
  CONSTRAINT property_documents_verification_status_check CHECK (
    verification_status IN ('pending', 'submitted', 'verified', 'rejected')
  )
);

COMMENT ON TABLE public.property_documents IS
  'Sale deeds, 7/12 extracts, tax receipts, and other private files. Not public.';
COMMENT ON COLUMN public.property_documents.verification_status IS
  'Only an admin can move this to verified or rejected.';

CREATE INDEX IF NOT EXISTS idx_property_documents_property_id ON public.property_documents (property_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_documents;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
