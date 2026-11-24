import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LiveController } from "../lib/controller.mjs";
import { createLiveServer } from "../lib/server.mjs";

async function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "live-server-data-"));
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "live-server-web-"));
  fs.writeFileSync(path.join(webRoot, "index.html"), "<!doctype html><title>workbench</title><p>workbench</p>");
  fs.writeFileSync(path.join(webRoot, "overlay.html"), "<!doctype html><title>overlay</title><p>overlay</p>");
  const controller = new LiveController({ dataDir });
  await controller.init();
  const server = await createLiveServer({ controller, webRoot, dataDir, preferredPort: 0 });
  return { controller, server, dataDir, webRoot };
}

async function teardown(context) {
  await context.server.stop();
  await context.controller.dispose();
  fs.rmSync(context.dataDir, { recursive: true, force: true });
  fs.rmSync(context.webRoot, { recursive: true, force: true });
}

function authUrl(server, route) {
  return `${server.info().baseUrl}${route}${route.includes("?") ? "&" : "?"}token=${encodeURIComponent(server.token)}`;
}

async function json(url, init) {
  const response = await fetch(url, init);
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

test("本地服务：健康检查、鉴权、页面与 SSE", async () => {
  const context = await setup();
  try {
    const { server } = context;
    const health = await json(`${server.info().baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const denied = await json(`${server.info().baseUrl}/api/state`);
    assert.equal(denied.status, 401);

    const state = await json(authUrl(server, "/api/state"));
    assert.equal(state.status, 200);
    assert.equal(state.data.app, "ruodao-live-workbench");

    const overlayDenied = await fetch(`${server.info().baseUrl}/overlay`);
    assert.equal(overlayDenied.status, 403);
    const overlay = await fetch(server.info().overlayUrl);
    assert.equal(overlay.status, 200);
    assert.match(await overlay.text(), /overlay/);

    const workbench = await fetch(server.info().workbenchUrl);
    assert.equal(workbench.status, 200);
    assert.match(await workbench.text(), /workbench/);

    const controller = new AbortController();
    const stream = await fetch(authUrl(server, "/api/stream"), { signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type") || "", /text\/event-stream/);
    const reader = stream.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /event: state/);
    controller.abort();
  } finally {
    await teardown(context);
  }
});

test("本地服务：开播、测试礼物、报告与归档接口", async () => {
  const context = await setup();
  try {
    const { server, controller } = context;
    const start = await json(authUrl(server, "/api/session/start"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId: "human-vs-zombie" }),
    });
    assert.equal(start.status, 200);
    assert.equal(start.data.report.gameId, "human-vs-zombie");
    controller.stopDemo();
    controller.relay.stop();

    for (let index = 0; index < 10; index += 1) {
      const gift = await json(authUrl(server, "/api/event/gift"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userName: "接口测试", giftId: "crown", count: 1 }),
      });
      assert.equal(gift.status, 200);
      assert.equal(gift.data.result.ok, true);
    }

    const state = await json(authUrl(server, "/api/state"));
    assert.equal(state.data.engine.round.status, "running");
    assert.equal(state.data.totals.heat, 1000);

    const report = await json(authUrl(server, "/api/session/report"));
    assert.equal(report.status, 200);
    assert.equal(report.data.report.totals.gifts, 10);

    const stop = await json(authUrl(server, "/api/session/stop"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(stop.status, 200);
    assert.equal(stop.data.report.status, "ended");

    const sessions = await json(authUrl(server, "/api/sessions"));
    assert.equal(sessions.data.sessions.length, 1);
    const id = sessions.data.sessions[0].id;
    const events = await json(authUrl(server, `/api/sessions/${id}/events?limit=100`));
    assert.equal(events.data.events.length, 10);
    const remove = await json(authUrl(server, `/api/sessions/${id}`), { method: "DELETE" });
    assert.equal(remove.status, 200);
    const after = await json(authUrl(server, "/api/sessions"));
    assert.equal(after.data.sessions.length, 0);
  } finally {
    await teardown(context);
  }
});

test("旧数字人接口已彻底移除", async () => {
  const context = await setup();
  try {
    const { server } = context;
    const response = await fetch(authUrl(server, "/api/avatar"));
    assert.equal(response.status, 404);
  } finally {
    await teardown(context);
  }
});