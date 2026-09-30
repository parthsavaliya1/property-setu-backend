-- Search indexes. Unique keys and a few foreign keys are already indexed by earlier migrations.

CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON public.properties (owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_category_id ON public.properties (category_id);
CREATE INDEX IF NOT EXISTS idx_properties_agency_id ON public.properties (agency_id);
CREATE INDEX IF NOT EXISTS idx_properties_agent_id ON public.properties (agent_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON public.properties (status);
CREATE INDEX IF NOT EXISTS idx_properties_listing_type ON public.properties (listing_type);
CREATE INDEX IF NOT EXISTS idx_properties_price ON public.properties (price);
CREATE INDEX IF NOT EXISTS idx_properties_created_at ON public.properties (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_properties_is_featured ON public.properties (is_featured);
CREATE INDEX IF NOT EXISTS idx_properties_is_premium ON public.properties (is_premium);

CREATE INDEX IF NOT EXISTS idx_properties_owner_status
  ON public.properties (owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_properties_browse
  ON public.properties (status, listing_type, category_id, price);

CREATE INDEX IF NOT EXISTS idx_properties_published_recent
  ON public.properties (created_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_properties_featured_live
  ON public.properties (created_at DESC)
  WHERE status = 'published' AND is_featured = true;

CREATE INDEX IF NOT EXISTS idx_properties_title_trgm
  ON public.properties USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_properties_description_trgm
  ON public.properties USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_property_locations_city ON public.property_locations (city);
CREATE INDEX IF NOT EXISTS idx_property_locations_district ON public.property_locations (district);
CREATE INDEX IF NOT EXISTS idx_property_locations_state ON public.property_locations (state);
CREATE INDEX IF NOT EXISTS idx_property_locations_pincode ON public.property_locations (pincode);
CREATE INDEX IF NOT EXISTS idx_property_locations_lat_lng
  ON public.property_locations (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_property_locations_city_state
  ON public.property_locations (state, city, district);
CREATE INDEX IF NOT EXISTS idx_property_locations_point
  ON public.property_locations USING gist (location_point);

CREATE INDEX IF NOT EXISTS idx_property_images_property_id ON public.property_images (property_id);
CREATE INDEX IF NOT EXISTS idx_property_videos_property_id ON public.property_videos (property_id);
CREATE INDEX IF NOT EXISTS idx_property_favorites_property_id ON public.property_favorites (property_id);
CREATE INDEX IF NOT EXISTS idx_property_favorites_user_id ON public.property_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_property_views_property_id ON public.property_views (property_id);
CREATE INDEX IF NOT EXISTS idx_property_views_user_id ON public.property_views (user_id);
CREATE INDEX IF NOT EXISTS idx_property_inquiries_property_id ON public.property_inquiries (property_id);
CREATE INDEX IF NOT EXISTS idx_property_inquiries_buyer_id ON public.property_inquiries (buyer_id);
CREATE INDEX IF NOT EXISTS idx_property_visits_property_id ON public.property_visits (property_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON public.saved_searches (user_id);

CREATE INDEX IF NOT EXISTS idx_property_inquiries_status ON public.property_inquiries (property_id, status);
CREATE INDEX IF NOT EXISTS idx_property_visits_buyer_id ON public.property_visits (buyer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id, created_at DESC);
