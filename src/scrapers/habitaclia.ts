import { BaseScraper, sleep, smoothScroll } from "./baseScraper";
import { Lead } from "../utils/supabase";

// Habitaclia: viviendas particulares en Barcelona provincia
const URLS = {
  venta:
    "https://www.habitaclia.com/venta-viviendas-en-barcelona/listaparticulares.htm",
  alquiler:
    "https://www.habitaclia.com/alquiler-viviendas-en-barcelona/listaparticulares.htm",
};

export class HabitacliaScraper extends BaseScraper {
  readonly source = "habitaclia";

  async scrape(maxLeads: number): Promise<Lead[]> {
    const leads: Lead[] = [];

    for (const [tipo, url] of Object.entries(URLS)) {
      if (leads.length >= maxLeads) break;
      console.log(`[habitaclia] Scraping ${tipo}...`);
      const found = await this.scrapeSection(url, tipo, maxLeads - leads.length);
      leads.push(...found);
    }

    console.log(`[habitaclia] Total: ${leads.length} leads`);
    return leads;
  }

  private async scrapeSection(
    url: string,
    tipo: string,
    maxLeads: number
  ): Promise<Lead[]> {
    const leads: Lead[] = [];
    const page = await this.context!.newPage();
    await this.blockHeavyResources(page);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(3000, 5000);
      await this.acceptCookies(page);

      let currentPage = 1;

      while (leads.length < maxLeads) {
        console.log(`[habitaclia/${tipo}] Página ${currentPage}...`);
        await smoothScroll(page);
        await sleep(2000, 4000);

        // Habitaclia listing cards
        const cards = await page
          .locator("article.js-list-item, div.list-item")
          .all();
        if (cards.length === 0) {
          console.log(`[habitaclia/${tipo}] No se encontraron anuncios.`);
          break;
        }

        for (const card of cards) {
          if (leads.length >= maxLeads) break;

          try {
            // Title and link
            const linkEl = card.locator("a.list-item-title, a[class*='title']").first();
            const title = (await linkEl.textContent()) ?? "";
            const href = await linkEl.getAttribute("href");
            if (!href) continue;

            const fullLink = href.startsWith("http")
              ? href
              : `https://www.habitaclia.com${href}`;

            // External ID from URL
            const idMatch = fullLink.match(/(\d{5,})/);
            const externalId = idMatch ? idMatch[1] : fullLink;

            // Price
            const priceText =
              (await card
                .locator("span.list-item-price, span[class*='price']")
                .first()
                .textContent()) ?? "0";
            const price =
              parseInt(priceText.replace(/[^\d]/g, ""), 10) || null;

            // Open detail page
            const detailPage = await this.context!.newPage();
            try {
              await detailPage.goto(fullLink, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              });
              await sleep(2000, 4000);

              // Verify particular
              const bodyText =
                (await detailPage.textContent("body"))?.toLowerCase() ?? "";
              if (
                !bodyText.includes("particular") &&
                !bodyText.includes("propietario")
              ) {
                continue;
              }

              // Get phone
              let phone = "";
              try {
                const phoneBtn = detailPage.locator(
                  "a.btn-phone, button:has-text('Ver teléfono'), a:has-text('Llamar'), button:has-text('Llamar')"
                );
                if (await phoneBtn.first().isVisible({ timeout: 3000 })) {
                  await phoneBtn.first().click();
                  await sleep(1500, 3000);

                  const phoneEl = detailPage.locator(
                    "a[href^='tel:'], span.phone-number, span[class*='phone']"
                  );
                  if (await phoneEl.first().isVisible({ timeout: 3000 })) {
                    phone =
                      (await phoneEl.first().textContent())?.replace(
                        /[^\d+]/g,
                        ""
                      ) ?? "";
                  }
                }
              } catch {}

              if (!phone) continue;

              // Address
              const address =
                (await detailPage
                  .locator("h2.detail-section-location, span[class*='location']")
                  .first()
                  .textContent()) ?? title;

              // Coordinates
              const { lat, lng } = await this.extractCoordinates(detailPage);
              const { ok, distanceKm } = this.checkDistance(lat, lng);

              if (!ok) {
                console.log(
                  `[habitaclia] Fuera de radio (${distanceKm.toFixed(1)}km): ${address.trim()}`
                );
                continue;
              }

              leads.push({
                external_id: `habitaclia-${externalId}`,
                title: title.trim().slice(0, 255),
                price,
                phone,
                address: address.trim(),
                lat,
                lng,
                distance_km: Math.round(distanceKm * 10) / 10,
                source: "habitaclia",
                status: "nuevo",
              });

              console.log(
                `[habitaclia] [${leads.length}] ${phone} – ${address.trim()} (${distanceKm.toFixed(1)}km)`
              );
            } finally {
              await detailPage.close();
            }
          } catch (err) {
            console.warn("[habitaclia] Error en card:", (err as Error).message);
          }
        }

        // Next page
        const nextBtn = page.locator(
          "a[rel='next'], a.next, li.next a"
        );
        if ((await nextBtn.count()) > 0 && leads.length < maxLeads) {
          await nextBtn.first().click();
          await sleep(3000, 5000);
          currentPage++;
        } else {
          break;
        }
      }
    } catch (err) {
      console.error(`[habitaclia/${tipo}] Error:`, (err as Error).message);
    } finally {
      await page.close();
    }

    return leads;
  }
}
