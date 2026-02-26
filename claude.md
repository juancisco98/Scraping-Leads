# Proyecto: Lead Generator Inmobiliario BCN 80km

## 🎯 Objetivo
Desarrollar un sistema de scraping automatizado para captar leads de vendedores particulares en un radio de **80km desde Barcelona (41.3851, 2.1734)**. Los datos deben ser almacenados en Supabase y filtrados para evitar duplicados.

## 🛠 Stack Tecnológico
- **Entorno:** Node.js / TypeScript
- **Scraping:** Playwright con plugin `stealth`
- **Base de Datos:** Supabase (PostgreSQL)
- **Infraestructura:** Hosting en Vercel (Cron Jobs)
- **Geolocalización:** Fórmula de Haversine para cálculo de distancia manual.

## 📍 Reglas de Ubicación (Radio 80km)
1. **Punto de Origen:** Barcelona Centro (41.3851, 2.1734).
2. **Filtrado:** - Si el portal permite filtrar por distancia en la URL (ej. `&r=80`), aplicarlo.
   - Si no, el script debe calcular la distancia de cada propiedad usando la Fórmula de Haversine.
   - **Restricción:** Solo insertar en la base de datos si `distancia <= 80.0 km`.

## 🏗 Esquema de Datos (Supabase)
Tabla: `leads_vendedores`
- `external_id`: Identificador único del anuncio (para evitar duplicados).
- `phone`: Teléfono del particular (UNIQUE).
- `distance_km`: Distancia calculada desde Barcelona.
- `status`: Estado del lead ('nuevo', 'contactado', 'visita', 'captado').

## 🕵️ Estrategia de Scraping y Anti-Bloqueo
1. **Filtro Particular:** Extraer exclusivamente anuncios marcados como "Particular".
2. **Humano-Simulado:** - User-Agents aleatorios.
   - Retrasos de entre 2 y 5 segundos entre acciones.
   - Scroll suave para cargar contenido dinámico.
3. **Deduplicación:** Usar `ON CONFLICT (phone) DO NOTHING` para no repetir contactos.

## 🚀 Instrucciones para Claude Code
1. Configura el cliente de Supabase con las variables de entorno.
2. Crea una utilidad `geoUtils.ts` con la fórmula de Haversine.
3. Desarrolla el scraper para el portal objetivo (ej. Idealista o Fotocasa) usando Playwright.
4. Asegúrate de capturar: Título, Precio, Teléfono, Dirección y Coordenadas (si están disponibles) o Nombre de la Zona.
5. Sincroniza los resultados válidos con la tabla `leads_vendedores`.

## ⚠️ Restricciones
- Límite de 50 leads por ejecución para evitar detección.
- Todas las credenciales deben estar en un archivo `.env`.