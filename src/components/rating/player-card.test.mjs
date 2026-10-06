import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

test("선수 카드는 비회원·확정 랭크·배정 중 데이터를 구분한다", async () => {
  const server = await createServer({ configFile: false, plugins: [react()], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } });
  try {
    const { default: PlayerCard } = await server.ssrLoadModule("/src/components/rating/PlayerCard.jsx");
    const render = (props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: "/app" }, React.createElement(PlayerCard, props)));
    const guest = render({});
    assert.match(guest, /미발급/);
    assert.match(guest, /href="\/login\?redirect=%2Fapp&amp;backTo=%2Fapp"/);
    assert.doesNotMatch(guest, /\d+ MMR/);

    const user = { id: "card-check", name: "검증 선수", ratings: { integrated: 1200 } };
    const ranked = render({ user, recentFiveWins: 3, mySeasonRow: { seasonWins: 8, seasonLosses: 5 }, mySeasonIndex: 4 });
    assert.match(ranked, /1200 MMR/);
    assert.match(ranked, /8승 5패/);
    assert.match(ranked, /5위/);
    assert.match(ranked, /href="\/app\/players\/card-check"/);

    const placement = render({ user: { ...user, ratings: { ...user.ratings, placement: { matchCount: 2, target: 5, completed: false } } } });
    assert.match(placement, /배정 전 · 2\/5/);
    assert.doesNotMatch(placement, /1200 MMR/);
  } finally {
    await server.close();
  }
});
