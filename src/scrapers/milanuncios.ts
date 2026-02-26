import { BaseScraper, sleep, smoothScroll } from "./baseScraper";
import { Lead } from "../utils/supabase";

// Milanuncios: inmuebles particulares en Barcelona
const URLS = {
  venta:
    "https://www.milanuncios.com/inmobiliaria-en-barcelona/particular/",
  alquiler:
    "https://www.milanuncios.com/alquiler-en-barcelona/particular/",
};

export class MilanunciosScraper extends BaseScraper {
  readonly source = "milanuncios";

  async scrape(maxLeads: number): Promise<Lead[]> {
    const leads: Lead[] = [];

    for (const [tipo, url] of Object.entries(URLS)) {
      if (leads.length >= maxLeads) break;
      console.log(`[milanuncios] Scraping ${tipo}...`);
      const found = await this.scrapeSection(url, tipo, maxLeads - leads.length);
      leads.push(...found);
    }

    console.log(`[milanuncios] Total: ${leads.length} leads`);
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
        console.log(`[milanuncios/${tipo}] Página ${currentPage}...`);
        await smoothScroll(page);
        await sleep(2000, 4000);

        // Milanuncios listing cards
        const cards = await page
          .locator("article.ma-AdCard, div.ma-AdCard, article[class*='AdCard']")
          .all();
        if (cards.length === 0) {
          console.log(`[milanuncios/${tipo}] No se encontraron anuncios.`);
          break;
        }

        for (const card of cards) {
          if (leads.length >= maxLeads) break;

          try {
            // Title and link
            const linkEl = card.locator("a.ma-AdCard-titleLink, a[class*='AdCard-title']").first();
            const title = (await linkEl.textContent()) ?? "";
            const href = await linkEl.getAttribute("href");
            if (!href) continue;

            const fullLink = href.startsWith("http")
              ? href
              : `https://www.milanuncios.com${href}`;

            // External ID from URL
            const idMatch = fullLink.match(/(\d{5,})/);
            const externalId = idMatch ? idMatch[1] : fullLink;

            // Price
            const priceText =
              (await card
                .locator("span.ma-AdCard-price, span[class*='AdCard-price']")
                .first()
                .textContent()) ?? "0";
            const price =
              parseInt(priceText.replace(/[^\d]/g, ""), 10) || null;

            // Location from card
            const locationText =
              (await card
                .locator("span.ma-AdCard-location, span[class*='location']")
                .first()
                .textContent()) ?? "";

            // Open detail page
            const detailPage = await this.context!.newPage();
            try {
              await detailPage.goto(fullLink, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              });
              await sleep(2000, 4000);

              // Milanuncios shows "Particular" badge
              const bodyText =
                (await detailPage.textContent("body"))?.toLowerCase() ?? "";
              if (
                bodyText.includes("profesional") ||
                bodyText.includes("inmobiliaria")
              ) {
                continue;
              }

              // Get phone – Milanuncios has a "Ver teléfono" button
              let phone = "";
              try {
                const phoneBtn = detailPage.locator(
                  "button:has-text('Ver teléfono'), button:has-text('Llamar'), a:has-text('Ver teléfono')"
                );
                if (await phoneBtn.first().isVisible({ timeout: 3000 })) {
                  await phoneBtn.first().click();
                  await sleep(1500, 3000);

                  const phoneEl = detailPage.locator(
                    "a[href^='tel:'], span[class*='phone'], div[class*='phone']"
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

              // Fallback: extract phone from description
              if (!phone) {
                try {
                  const desc =
                    (await detailPage
                      .locator("div.ma-AdDetail-description, div[class*='description']")
                      .first()
                      .textContent()) ?? "";
                  const phoneMatch = desc.match(
                    /(?:\+34|0034)?[\s.-]?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/
                  );
                  if (phoneMatch) {
                    phone = phoneMatch[0].replace(/[\s.-]/g, "");
                  }
                } catch {}
              }

              if (!phone) continue;

              // Address
              const address =
                (await detailPage
                  .locator("span[class*='location'], div[class*='location']")
                  .first()
                  .textContent()) ?? (locationText || title);

              // Coordinates
              const { lat, lng } = await this.extractCoordinates(detailPage);
              const { ok, distanceKm } = this.checkDistance(lat, lng);

              if (!ok) {
                console.log(
                  `[milanuncios] Fuera de radio (${distanceKm.toFixed(1)}km): ${address.trim()}`
                );
                continue;
              }

              leads.push({
                external_id: `milanuncios-${externalId}`,
                title: title.trim().slice(0, 255),
                price,
                phone,
                address: address.trim(),
                lat,
                lng,
                distance_km: Math.round(distanceKm * 10) / 10,
                source: "milanuncios",
                status: "nuevo",
              });

              console.log(
                `[milanuncios] [${leads.length}] ${phone} – ${address.trim()} (${distanceKm.toFixed(1)}km)`
              );
            } finally {
              await detailPage.close();
            }
          } catch (err) {
            console.warn(
              "[milanuncios] Error en card:",
              (err as Error).message
            );
          }
        }

        // Next page
        const nextBtn = page.locator(
          "a[rel='next'], a.ma-Pagination-next, li.next a"
        );
        if ((await nextBtn.count()) > 0 && leads.length < maxLeads) {
          await nextBtn.first().click();
          await sleep(4000, 6000);
          currentPage++;
        } else {
          break;
        }
      }
    } catch (err) {
      console.error(`[milanuncios/${tipo}] Error:`, (err as Error).message);
    } finally {
      await page.close();
    }

    return leads;
  }
}
