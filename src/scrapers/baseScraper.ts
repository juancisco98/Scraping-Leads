import { Browser, BrowserContext, Page, chromium } from "playwright";
import { Lead } from "../utils/supabase";
import { haversineDistance, isWithinRadius } from "../utils/geo";

// ── Re-exportar geo utils para que los scrapers hijos los usen ──
export { haversineDistance, isWithinRadius };

// ── Anti-detección ──────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function sleep(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

export async function smoothScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const distance = 300;
    const delay = 150;
    const steps = Math.ceil(document.body.scrollHeight / distance);
    for (let i = 0; i < steps; i++) {
      window.scrollBy(0, distance);
      await new Promise((r) => setTimeout(r, delay));
    }
  });
}

// ── Resultado tipado ────────────────────────────────────────────
export interface ScraperResult {
  source: string;
  leads: Lead[];
}

// ── Clase base abstracta ────────────────────────────────────────
export abstract class BaseScraper {
  abstract readonly source: string;
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;

  async init(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: randomUA(),
      viewport: { width: 1366, height: 768 },
      locale: "es-ES",
    });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
  }

  /** Método que cada scraper hijo debe implementar. */
  abstract scrape(maxLeads: number): Promise<Lead[]>;

  /** Ejecuta el ciclo completo: init → scrape → close. */
  async run(maxLeads: number): Promise<ScraperResult> {
    try {
      await this.init();
      console.log(`\n[${"=".repeat(40)}]`);
      console.log(`Iniciando scraper: ${this.source}`);
      console.log(`[${"=".repeat(40)}]\n`);
      const leads = await this.scrape(maxLeads);
      return { source: this.source, leads };
    } catch (err) {
      console.error(`[${this.source}] Error fatal:`, (err as Error).message);
      return { source: this.source, leads: [] };
    } finally {
      await this.close();
    }
  }

  // ── Helpers comunes de validación de distancia ────────────────

  /** Calcula distancia y decide si el lead está dentro del radio de 80km. */
  protected checkDistance(lat: number | null, lng: number | null): {
    ok: boolean;
    distanceKm: number;
  } {
    if (lat === null || lng === null) return { ok: true, distanceKm: 0 };
    const distanceKm = haversineDistance(lat, lng);
    return { ok: isWithinRadius(lat, lng), distanceKm };
  }

  /** Bloquea recursos pesados en una página para acelerar la carga. */
  protected async blockHeavyResources(page: Page): Promise<void> {
    await page.route("**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2}", (route) =>
      route.abort()
    );
  }

  /** Acepta banner de cookies con selectores comunes. */
  protected async acceptCookies(page: Page): Promise<void> {
    try {
      const btn = page.locator(
        "#didomi-notice-agree-button, #onetrust-accept-btn-handler, button:has-text('Aceptar todas'), button:has-text('Aceptar')"
      );
      if (await btn.first().isVisible({ timeout: 3000 })) {
        await btn.first().click();
        await sleep(1000, 2000);
      }
    } catch {
      // No cookie banner
    }
  }

  /** Intenta extraer coordenadas de JSON-LD o mapas embebidos. */
  protected async extractCoordinates(
    page: Page
  ): Promise<{ lat: number | null; lng: number | null }> {
    let lat: number | null = null;
    let lng: number | null = null;

    // JSON-LD
    try {
      const scripts = await page
        .locator('script[type="application/ld+json"]')
        .all();
      for (const script of scripts) {
        const json = await script.textContent();
        if (!json) continue;
        const parsed = JSON.parse(json);
        if (parsed?.geo) {
          lat = parseFloat(parsed.geo.latitude);
          lng = parseFloat(parsed.geo.longitude);
        }
        if (parsed?.availableAtOrFrom?.geo) {
          lat = parseFloat(parsed.availableAtOrFrom.geo.latitude);
          lng = parseFloat(parsed.availableAtOrFrom.geo.longitude);
        }
      }
    } catch {}

    // Fallback: map image/iframe
    if (lat === null || lng === null) {
      try {
        const mapSrc = await page
          .locator("img[src*='maps'], iframe[src*='maps'], a[href*='maps']")
          .first()
          .getAttribute("src", { timeout: 2000 })
          .catch(() =>
            page
              .locator("a[href*='maps']")
              .first()
              .getAttribute("href", { timeout: 1000 })
          );
        if (mapSrc) {
          const match = mapSrc.match(/(?:center=|@|q=)([-\d.]+),([-\d.]+)/);
          if (match) {
            lat = parseFloat(match[1]);
            lng = parseFloat(match[2]);
          }
        }
      } catch {}
    }

    // Fallback: data attributes
    if (lat === null || lng === null) {
      try {
        const el = page.locator("[data-latitude], [data-lat]");
        if ((await el.count()) > 0) {
          const latStr =
            (await el.first().getAttribute("data-latitude")) ??
            (await el.first().getAttribute("data-lat"));
          const lngStr =
            (await el.first().getAttribute("data-longitude")) ??
            (await el.first().getAttribute("data-lng"));
          if (latStr && lngStr) {
            lat = parseFloat(latStr);
            lng = parseFloat(lngStr);
          }
        }
      } catch {}
    }

    return { lat, lng };
  }
}
