import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function loadServerEnv(mode) {
  const env = loadEnv(mode, process.cwd(), "");
  Object.entries(env).forEach(([key, value]) => {
    if (process.env[key] === undefined) process.env[key] = value;
  });
}

function rankballApiDevPlugin() {
  return {
    name: "rankball-api-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/api")) {
          next();
          return;
        }

        try {
          const { default: handler } = await import("./api/index.js");
          const apiResponse = {
            setHeader: (...args) => response.setHeader(...args),
            status(code) {
              response.statusCode = code;
              return this;
            },
            json(payload) {
              if (!response.headersSent) response.setHeader("Content-Type", "application/json; charset=utf-8");
              response.end(JSON.stringify(payload));
            },
          };
          await handler(request, apiResponse);
        } catch (error) {
          server.config.logger.error(`RankBall dev API failed: ${error?.message || error}`);
          if (!response.headersSent) response.statusCode = 500;
          response.end(JSON.stringify({ error: "dev_api_failed" }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  loadServerEnv(mode);
  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [react(), rankballApiDevPlugin()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
              return "vendor-react";
            }
            if (id.includes("node_modules/@supabase")) {
              return "vendor-supabase";
            }
            if (id.includes("src/data/repository.js")) {
              return "state-core";
            }
            if (id.includes("node_modules/lucide-react")) {
              return "vendor-icons";
            }
            return undefined;
          }
        },
      },
    },
  };
});
