const express = require("express");
const next = require("next");
const Keyv = require("keyv");
const { resolve: urlResolve } = require("url");
const normalizeUrl = require("normalize-url");
const cacheableResponse = require("cacheable-response");

const isDevEnvironment = process.env.NODE_ENV !== "production";

const nextApp = next({ dev: isDevEnvironment, dir: "./src" });

const defaultRequestHandler = nextApp.getRequestHandler();

const cacheStore = new Keyv({ namespace: "ssr-cache" });

const _getSSRCacheKey = (req) => {
  const url = urlResolve("http://localhost", req.url);
  const { origin } = new URL(url);
  const baseKey = normalizeUrl(url, {
    removeQueryParameters: [
      "embed",
      "filter",
      "force",
      "proxy",
      "ref",
      /^utm_\w+/i,
    ],
  });
  return baseKey.replace(origin, "").replace("/?", "");
};

const cacheManager = cacheableResponse({
  ttl: 1000 * 60 * 60, // 1hour
  get: async ({ req, res, pagePath, queryParams }) => {
    try {
      return {
        data: await nextApp.renderToHTML(req, res, pagePath, queryParams),
      };
    } catch (e) {
      return { data: "error: " + e };
    }
  },
  send: ({ data, res }) => {
    res.send(data);
  },
  cache: cacheStore,
  getKey: _getSSRCacheKey,
  compress: true,
});

function clearCompleteCache(res, req) {
  cacheStore.clear();
  res.status(200);
  res.send({
    path: req.hostname + req.baseUrl,
    purged: true,
    clearedCompleteCache: true,
  });
  res.end();
}

function clearCacheForRequestUrl(req, res) {
  let key = _getSSRCacheKey(req);
  console.log(key);
  cacheStore.delete(key);
  res.status(200);
  res.send({
    path: req.hostname + req.baseUrl + req.path,
    key: key,
    purged: true,
    clearedCompleteCache: false,
  });
  res.end();
}

nextApp
  .prepare()
  .then(() => {
    const server = express();

    // Do not use caching for _next files
    server.get("/_next/*", (req, res) => {
      defaultRequestHandler(req, res);
    });

    server.get("*", (req, res) => {
      if (isDevEnvironment || req.query.noCache) {
        res.setHeader("X-Cache-Status", "DISABLED");
        defaultRequestHandler(req, res);
      } else {
        cacheManager({ req, res, pagePath: req.path });
      }
    });

    server.purge("*", (req, res) => {
      if (req.query.clearCache) {
        clearCompleteCache(res, req);
      } else {
        clearCacheForRequestUrl(req, res);
      }
    });

    server.listen(3000, (err) => {
      if (err) throw err;
      console.log("> Ready on http://localhost:3000");
    });
  })
  .catch((ex) => {
    console.error(ex.stack);
    process.exit(1);
  });
