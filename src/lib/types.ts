// Row shapes for the tables the app reads. Once a Supabase project exists,
// replace these with generated types: `npx supabase gen types typescript`.

export type AppRole = "rider" | "staff" | "admin";
export type EventStatus = "draft" | "published" | "canceled" | "completed";
export type RegistrationStatus = "pending_payment" | "confirmed" | "waitlisted" | "canceled" | "refunded";

export interface Profile {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  gender: "woman" | "man" | "non_binary" | "prefer_not_to_say" | null;
  team: string | null;
  usac_license_number: string | null;
  usac_license_expiry: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  role: AppRole;
  onboarded_at: string | null;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  coordinates_confirmed: boolean;
  parking_notes: string;
  map_embed_url: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  eligibility_notes: string;
  min_age: number | null;
  sort_order: number;
}

export interface EventCategory {
  id: string;
  event_id: string;
  category_id: string;
  start_at: string;
  duration_minutes: number;
  laps: number | null;
  capacity: number;
  price_cents: number;
  walk_up_price_cents: number;
  categories: Pick<Category, "name" | "sort_order" | "description" | "eligibility_notes">;
}

export interface RaceEvent {
  id: string;
  season_id: string;
  venue_id: string;
  name: string;
  event_date: string;
  registration_opens_at: string;
  registration_closes_at: string;
  status: EventStatus;
  notes: string;
  weather_override_text: string | null;
}

export interface Availability {
  event_category_id: string;
  event_id: string;
  capacity: number;
  registered_count: number;
  waitlist_count: number;
  spots_left: number;
}
