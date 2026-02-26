import "dotenv/config";
import { Lead, upsertLeads } from "./utils/supabase";
import { BaseScraper } from "./scrapers/baseScraper";
import { MilanunciosScraper } from "./scrapers/milanuncios";

const MAX_LEADS_TOTAL = 50;

async function main() {
  console.log("=== Lead Generator Inmobiliario BCN 80km ===");
  console.log(`Inicio: ${new Date().toISOString()}`);
  console.log(`Límite total: ${MAX_LEADS_TOTAL} leads\n`);

  const scrapers: BaseScraper[] = [
    new MilanunciosScraper(),
  ];

  const allLeads: Lead[] = [];

  for (const scraper of scrapers) {
    const remaining = MAX_LEADS_TOTAL - allLeads.length;
    if (remaining <= 0) {
      console.log(`\nLímite alcanzado. Saltando ${scraper.source}.`);
      break;
    }

    const result = await scraper.run(remaining);
    allLeads.push(...result.leads);
    console.log(
      `\n→ ${scraper.source}: ${result.leads.length} leads | Total acumulado: ${allLeads.length}/${MAX_LEADS_TOTAL}`
    );
  }

  if (allLeads.length > 0) {
    console.log(`\nSubiendo ${allLeads.length} leads a Supabase...`);
    const inserted = await upsertLeads(allLeads);
    console.log(`Resultado: ${inserted} leads procesados`);
  } else {
    console.log("\nNo se encontraron leads válidos.");
  }

  // Resumen
  const bySource = allLeads.reduce(
    (acc, l) => {
      acc[l.source] = (acc[l.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log("\n=== Resumen ===");
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}: ${count} leads`);
  }
  console.log(`  TOTAL: ${allLeads.length} leads`);
  console.log(`Fin: ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
