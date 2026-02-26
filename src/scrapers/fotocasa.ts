import { BaseScraper, sleep, smoothScroll } from "./baseScraper";
import { Lead } from "../utils/supabase";

const URLS = {
  venta:
    "https://www.fotocasa.es/es/comprar/viviendas/barcelona-provincia/publicado-por-particular/l",
  alquiler:
    "https://www.fotocasa.es/es/alquiler/viviendas/barcelona-provincia/publicado-por-particular/l",
};

export class FotocasaScraper extends BaseScraper {
  readonly source = "fotocasa";

  async scrape(maxLeads: number): Promise<Lead[]> {
    const leads: Lead[] = [];

    for (const [tipo, url] of Object.entries(URLS)) {
      if (leads.length >= maxLeads) break;
      console.log(`[fotocasa] Scraping ${tipo}...`);
      const found = await this.scrapeSection(url, tipo, maxLeads - leads.length);
      leads.push(...found);
    }

    console.log(`[fotocasa] Total: ${leads.length} leads`);
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
        console.log(`[fotocasa/${tipo}] Página ${currentPage}...`);
        await smoothScroll(page);
        await sleep(2000, 4000);

        const cards = await page.locator("article.re-CardPackMinimal").all();
        if (cards.length === 0) {
          console.log(`[fotocasa/${tipo}] No se encontraron anuncios.`);
          break;
        }

        for (const card of cards) {
          if (leads.length >= maxLeads) break;

          try {
            const title =
              (await card
                .locator("a.re-CardPackMinimal-info-container")
                .getAttribute("title")) ??
              (await card
                .locator("span.re-CardPackMinimal-info-title")
                .textContent()) ??
              "";

            const priceText =
              (await card
                .locator("span.re-CardPackMinimal-info-price-price")
                .textContent()) ?? "0";
            const price =
              parseInt(priceText.replace(/[^\d]/g, ""), 10) || null;

            const link = await card
              .locator("a.re-CardPackMinimal-info-container")
              .getAttribute("href");
            if (!link) continue;

            const fullLink = link.startsWith("http")
              ? link
              : `https://www.fotocasa.es${link}`;

            const idMatch = fullLink.match(/(\d{5,})/);
            const externalId = idMatch ? idMatch[1] : fullLink;
            const address = title.trim();

            // Detail page
            const detailPage = await this.context!.newPage();
            try {
              await detailPage.goto(fullLink, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              });
              await sleep(2000, 4000);

              // Get phone
              let phone = "";
              try {
                const phoneBtn = detailPage.locator(
                  "button:has-text('Llamar'), button:has-text('teléfono'), button:has-text('Ver teléfono')"
                );
                if (await phoneBtn.first().isVisible({ timeout: 3000 })) {
                  await phoneBtn.first().click();
                  await sleep(1500, 3000);
                  const phoneEl = detailPage.locator(
                    "a[href^='tel:'], span.re-ContactDetail-phone"
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

              const { lat, lng } = await this.extractCoordinates(detailPage);
              const { ok, distanceKm } = this.checkDistance(lat, lng);

              if (!ok) {
                console.log(
                  `[fotocasa] Fuera de radio (${distanceKm.toFixed(1)}km): ${address}`
                );
                continue;
              }

              leads.push({
                external_id: `fotocasa-${externalId}`,
                title: title.trim().slice(0, 255),
                price,
                phone,
                address,
                lat,
                lng,
                distance_km: Math.round(distanceKm * 10) / 10,
                source: "fotocasa",
                status: "nuevo",
              });

              console.log(
                `[fotocasa] [${leads.length}] ${phone} – ${address} (${distanceKm.toFixed(1)}km)`
              );
            } finally {
              await detailPage.close();
            }
          } catch (err) {
            console.warn("[fotocasa] Error en card:", (err as Error).message);
          }
        }

        // Next page
        const nextBtn = page.locator(
          "a[rel='next'], li.sui-MoleculePagination-item--next a"
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
      console.error(`[fotocasa/${tipo}] Error:`, (err as Error).message);
    } finally {
      await page.close();
    }

    return leads;
  }
}
