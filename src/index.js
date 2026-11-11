
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Pemeriksaan backend dan database
    if (url.pathname === "/api/health") {
      try {
        if (!env.DB) {
          throw new Error("Binding DB belum tersedia");
        }

        const result = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).all();

        return Response.json({
          ok: true,
          app: "TemanChat",
          phase: "database-connected",
          database: "connected",
          tables: result.results.map(row => row.name)
        }, {
          headers: {
            "Cache-Control": "no-store"
          }
        });

      } catch (error) {
        console.error("Database health check failed", error);

        return Response.json({
          ok: false,
          app: "TemanChat",
          database: "error"
        }, {
          status: 503,
          headers: {
            "Cache-Control": "no-store"
          }
        });
      }
    }

    // API lainnya belum diaktifkan
    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        error: "Endpoint belum tersedia."
      }, {
        status: 404,
        headers: {
          "Cache-Control": "no-store"
        }
      });
    }

    // Pertahankan tampilan website
    return env.ASSETS.fetch(request);
  }
};
