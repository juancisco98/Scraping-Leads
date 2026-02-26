import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(url, key);

export interface Lead {
  external_id: string;
  title: string;
  price: number | null;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distance_km: number;
  source: string;
  status: string;
}

export async function upsertLeads(leads: Lead[]): Promise<number> {
  if (leads.length === 0) return 0;

  const { data, error } = await supabase
    .from("leads_vendedores")
    .upsert(leads, { onConflict: "phone", ignoreDuplicates: true });

  if (error) {
    console.error("Supabase upsert error:", error.message);
    return 0;
  }

  console.log(`Inserted/skipped ${leads.length} leads`);
  return leads.length;
}
