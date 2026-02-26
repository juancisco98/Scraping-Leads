import { BaseScraper, sleep, smoothScroll } from "./baseScraper";
import { Lead } from "../utils/supabase";

const URLS = {
  venta:
    "https://www.idealista.com/venta-viviendas/barcelona-provincia/con-publicado_particulares/",
  alquiler:
    "https://www.idealista.com/alquiler-viviendas/barcelona-provincia/con-publicado_particulares/",
};

export class IdealistaScraper extends BaseScraper {
  readonly source = "idealista";

  async scrape(maxLeads: number): Promise<Lead[]> {
    const leads: Lead[] = [];

    for (const [tipo, url] of Object.entries(URLS)) {
      if (leads.length >= maxLeads) break;
      console.log(`[idealista] Scraping ${tipo}...`);
      const found = await this.scrapeSection(url, tipo, maxLeads - leads.length);
      leads.push(...found);
    }

    console.log(`[idealista] Total: ${leads.length} leads`);
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
      await sleep(3000, 6000);
      await this.acceptCookies(page);

      // Idealista es agresivo con CAPTCHAs
      const bodyText = await page.textContent("body");
      if (
        bodyText?.includes("captcha") ||
        bodyText?.includes("no eres un robot")
      ) {
        console.warn(`[idealista/${tipo}] CAPTCHA detectado. Saltando.`);
        await page.close();
        return leads;
      }

      let currentPage = 1;

      while (leads.length < maxLeads) {
        console.log(`[idealista/${tipo}] Página ${currentPage}...`);
        await smoothScroll(page);
        await sleep(2000, 5000);

        const items = await page.locator("article.item").all();
        if (items.length === 0) {
          console.log(`[idealista/${tipo}] No se encontraron anuncios.`);
          break;
        }

        for (const item of items) {
          if (leads.length >= maxLeads) break;

          try {
            const titleEl = item.locator("a.item-link").first();
            const title =
              (await titleEl.getAttribute("title")) ??
              (await titleEl.textContent()) ?? "";
            const href = await titleEl.getAttribute("href");
            if (!href) continue;

            const fullLink = href.startsWith("http")
              ? href
              : `https://www.idealista.com${href}`;

            const idMatch = fullLink.match(/(\d{5,})/);
            const externalId = idMatch ? idMatch[1] : fullLink;

            const priceText =
              (await item
                .locator("span.item-price, span.item-price h2")
                .first()
                .textContent()) ?? "0";
            const price =
              parseInt(priceText.replace(/[^\d]/g, ""), 10) || null;

            const locationText =
              (await item
                .locator("span.item-detail, span.item-location")
                .first()
                .textContent()) ?? title;

            // Detail page
            const detailPage = await this.context!.newPage();
            try {
              await detailPage.goto(fullLink, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              });
              await sleep(2000, 4000);

              const detailText = await detailPage.textContent("body");
              if (
                detailText?.includes("captcha") ||
                detailText?.includes("no eres un robot")
              ) {
                console.warn("[idealista] CAPTCHA en detalle, saltando.");
                continue;
              }

              // Get phone
              let phone = "";
              try {
                const phoneBtn = detailPage.locator(
                  "a.icon-phone, button:has-text('Ver teléfono'), a:has-text('Ver teléfono'), div.contact-phones-btn"
                );
                if (await phoneBtn.first().isVisible({ timeout: 3000 })) {
                  await phoneBtn.first().click();
                  await sleep(1500, 3000);

                  const phoneEl = detailPage.locator(
                    "a[href^='tel:'], span.phone-btn-text, p.phone"
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

              const address =
                (await detailPage
                  .locator("span#headerMap, span.main-info__title-minor")
                  .first()
                  .textContent()) ?? locationText;

              const { lat, lng } = await this.extractCoordinates(detailPage);
              const { ok, distanceKm } = this.checkDistance(lat, lng);

              if (!ok) {
                console.log(
                  `[idealista] Fuera de radio (${distanceKm.toFixed(1)}km): ${address.trim()}`
                );
                continue;
              }

              leads.push({
                external_id: `idealista-${externalId}`,
                title: title.trim().slice(0, 255),
                price,
                phone,
                address: address.trim(),
                lat,
                lng,
                distance_km: Math.round(distanceKm * 10) / 10,
                source: "idealista",
                status: "nuevo",
              });

              console.log(
                `[idealista] [${leads.length}] ${phone} – ${address.trim()} (${distanceKm.toFixed(1)}km)`
              );
            } finally {
              await detailPage.close();
            }
          } catch (err) {
            console.warn("[idealista] Error en item:", (err as Error).message);
          }
        }

        // Next page
        const nextBtn = page.locator("a.icon-arrow-right-after, a[rel='next']");
        if ((await nextBtn.count()) > 0 && leads.length < maxLeads) {
          await nextBtn.first().click();
          await sleep(4000, 7000);
          currentPage++;
        } else {
          break;
        }
      }
    } catch (err) {
      console.error(`[idealista/${tipo}] Error:`, (err as Error).message);
    } finally {
      await page.close();
    }

    return leads;
  }
}
