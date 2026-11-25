const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

// Lưu tạm trong RAM của instance Worker (tự reset khi Worker ngủ/khởi động lại)
const memoryStore = {
  messages: [],
  nextId: 1,
  users: new Map() // username -> { user, displayName, userId, server, lastSeen }
};

const ONLINE_TTL_MS = 120 * 1000; // Coi là online nếu ping trong 120 giây gần nhất
const MAX_MESSAGES = 200;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function pruneUsers() {
  const now = Date.now();
  for (const [key, info] of memoryStore.users.entries()) {
    if (!info || (now - (info.lastSeen || 0)) > ONLINE_TTL_MS) {
      memoryStore.users.delete(key);
    }
  }
}

function getActiveUsersArray() {
  pruneUsers();
  const list = [];
  for (const info of memoryStore.users.values()) {
    list.push({
      user: info.user,
      displayName: info.displayName,
      userId: info.userId,
      server: info.server
    });
  }
  return list;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 1. Lấy danh sách tin nhắn: GET /messages?after=0
    if (request.method === "GET" && path === "/messages") {
      const after = Number(url.searchParams.get("after") || "0") || 0;
      const filtered = memoryStore.messages.filter((m) => m.id > after);
      return jsonResponse({
        ok: true,
        messages: filtered,
        latestId: memoryStore.nextId - 1
      });
    }

    // 2. Gửi tin nhắn: POST /send
    if (request.method === "POST" && path === "/send") {
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
      }

      const user = String(body.user || "Player").slice(0, 40);
      const displayName = String(body.displayName || user).slice(0, 40);
      const userId = Number(body.userId || 0) || 0;
      const text = String(body.text || "").trim().slice(0, 200);
      const server = String(body.server || "Global").slice(0, 32);
      const time = Number(body.time || Math.floor(Date.now() / 1000));

      if (!text) {
        return jsonResponse({ ok: false, error: "Empty text" }, 400);
      }

      if (user && user !== "Player" && user !== "Hệ thống") {
        memoryStore.users.set(user, {
          user,
          displayName,
          userId,
          server,
          lastSeen: Date.now()
        });
      }

      const msg = {
        id: memoryStore.nextId++,
        user,
        displayName,
        userId,
        text,
        server,
        time
      };

      memoryStore.messages.push(msg);
      if (memoryStore.messages.length > MAX_MESSAGES) {
        memoryStore.messages.splice(0, memoryStore.messages.length - MAX_MESSAGES);
      }

      return jsonResponse({ ok: true, message: msg });
    }

    // 3. Điểm danh online: POST /ping
    if (request.method === "POST" && path === "/ping") {
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        body = {};
      }

      const user = String(body.user || "").trim().slice(0, 40);
      const displayName = String(body.displayName || user).slice(0, 40);
      const userId = Number(body.userId || 0) || 0;
      const server = String(body.server || "Global").slice(0, 32);

      if (user && user !== "Player" && user !== "Hệ thống") {
        memoryStore.users.set(user, {
          user,
          displayName,
          userId,
          server,
          lastSeen: Date.now()
        });
      }

      const users = getActiveUsersArray();
      return jsonResponse({
        ok: true,
        online: Math.max(1, users.length),
        users
      });
    }

    // 4. Xem danh sách online khi bấm nút Online: GET /online
    if (request.method === "GET" && path === "/online") {
      const users = getActiveUsersArray();
      return jsonResponse({
        ok: true,
        online: Math.max(1, users.length),
        users
      });
    }

    return jsonResponse({
      ok: true,
      service: "Hirose x Miyano Chat Worker",
      endpoints: ["/messages", "/send", "/ping", "/online"]
    });
  }
};
