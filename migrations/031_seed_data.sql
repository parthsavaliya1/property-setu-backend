-- Reference data only. No fake users and no fake listings.

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_name_unique
  ON public.subscription_plans (name);

INSERT INTO public.property_categories (name, slug, description, icon, sort_order)
VALUES
  ('Residential', 'residential', 'Homes and apartments people live in', 'home', 1),
  ('Land', 'land', 'Plots and agricultural or industrial land', 'land', 2),
  ('Commercial', 'commercial', 'Shops, offices, and other business properties', 'commercial', 3),
  ('Other', 'other', 'Property types that do not fit the groups above', 'other', 4)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.property_categories (parent_id, name, slug, description, icon, sort_order)
SELECT parent.id, child.name, child.slug, child.description, child.icon, child.sort_order
FROM (
  VALUES
    ('residential', 'Apartment', 'apartment', 'Flat in a building', 'apartment', 1),
    ('residential', 'House', 'house', 'Independent house', 'house', 2),
    ('residential', 'Villa', 'villa', 'Villa', 'villa', 3),
    ('residential', 'Bungalow', 'bungalow', 'Bungalow', 'bungalow', 4),
    ('residential', 'Farmhouse', 'farmhouse', 'Farmhouse', 'farmhouse', 5),
    ('residential', 'Penthouse', 'penthouse', 'Penthouse', 'penthouse', 6),
    ('land', 'Residential Plot', 'residential-plot', 'Plot for a home', 'plot', 1),
    ('land', 'Commercial Plot', 'commercial-plot', 'Plot for commercial use', 'commercial-plot', 2),
    ('land', 'Agricultural Land', 'agricultural-land', 'Farm land', 'agriculture', 3),
    ('land', 'Industrial Land', 'industrial-land', 'Land for industrial use', 'industry', 4),
    ('commercial', 'Shop', 'shop', 'Retail shop', 'shop', 1),
    ('commercial', 'Office', 'office', 'Office space', 'office', 2),
    ('commercial', 'Warehouse', 'warehouse', 'Warehouse or godown', 'warehouse', 3),
    ('commercial', 'Showroom', 'showroom', 'Showroom', 'showroom', 4),
    ('commercial', 'Hotel', 'hotel', 'Hotel', 'hotel', 5),
    ('commercial', 'Restaurant', 'restaurant', 'Restaurant', 'restaurant', 6),
    ('other', 'Other Property', 'other-property', 'Any other property type', 'other', 1)
) AS child(parent_slug, name, slug, description, icon, sort_order)
JOIN public.property_categories AS parent ON parent.slug = child.parent_slug
ON CONFLICT (slug) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order;

INSERT INTO public.amenities (name, slug, category, icon)
VALUES
  ('Parking', 'parking', 'convenience', 'parking'),
  ('Lift', 'lift', 'building', 'lift'),
  ('Swimming Pool', 'swimming-pool', 'lifestyle', 'pool'),
  ('Gym', 'gym', 'lifestyle', 'gym'),
  ('Garden', 'garden', 'outdoor', 'garden'),
  ('Security', 'security', 'safety', 'security'),
  ('CCTV', 'cctv', 'safety', 'cctv'),
  ('Power Backup', 'power-backup', 'utilities', 'power'),
  ('Water Supply', 'water-supply', 'utilities', 'water'),
  ('Club House', 'club-house', 'lifestyle', 'club'),
  ('Children''s Play Area', 'childrens-play-area', 'lifestyle', 'play'),
  ('Gas Pipeline', 'gas-pipeline', 'utilities', 'gas'),
  ('Gated Society', 'gated-society', 'safety', 'gate'),
  ('Visitor Parking', 'visitor-parking', 'convenience', 'visitor-parking'),
  ('Fire Safety', 'fire-safety', 'safety', 'fire'),
  ('Internet', 'internet', 'utilities', 'internet'),
  ('Air Conditioning', 'air-conditioning', 'comfort', 'ac')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  is_active = true;

INSERT INTO public.subscription_plans (
  name,
  description,
  price,
  duration_days,
  property_limit,
  featured_property_limit,
  is_active
)
VALUES
  ('Free', 'List a few properties at no charge', 0, 365, 5, 0, true),
  ('Basic', 'More listings and a couple of featured slots', 499, 30, 20, 2, true),
  ('Premium', 'Higher listing cap and featured placement', 1499, 30, 100, 10, true),
  ('Agency', 'For brokerages. Unlimited listings and more featured slots', 4999, 30, NULL, 30, true)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  duration_days = EXCLUDED.duration_days,
  property_limit = EXCLUDED.property_limit,
  featured_property_limit = EXCLUDED.featured_property_limit,
  is_active = EXCLUDED.is_active;
