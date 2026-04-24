const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { DEFAULT_DB_FILE, openDatabase } = require("../db");

function sendPublicFile(response, fileName) {
  response.sendFile(path.join(__dirname, "..", "public", fileName));
}

const crypto = require("crypto");

function createSessionId() { //generate a unique session ID
  return `SESSION-${crypto.randomBytes(16).toString("hex")}-${Date.now()}`;
}

function createCsrfToken() { //Generate a CRSF token with a random component and timestamp to ensure uniqueness and unpredictability
  return `CSRF-${crypto.randomBytes(16).toString("hex")}-${Date.now()}`;
}

async function createApp(databaseFile = DEFAULT_DB_FILE) {
  if (!fs.existsSync(DEFAULT_DB_FILE)) { //ensure the database file exists before starting the app
    throw new Error(
      `Database file not found at ${DEFAULT_DB_FILE}. Run "npm run init-db" first.`
    );
  }

  const db = openDatabase(DEFAULT_DB_FILE);
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/css", express.static(path.join(__dirname, "..", "public", "css")));
  app.use("/js", express.static(path.join(__dirname, "..", "public", "js")));

  app.use(async (request, response, next) => {
    const sessionId = request.cookies.sid;
    const csrfCookie = request.cookies.csrf;

    if (!sessionId) { //if no session cookie is present, treat as logged out user
      request.currentUser = null;
      request.csrfToken = csrfCookie || createCsrfToken();
      if (!csrfCookie) { //set CSRF cookie if it was not present in the request to ensure the client has it for future requests
        response.cookie("csrf", request.csrfToken, {
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/"
        });
      }
      next();
      return;
    }

    const row = await db.get(
      `
        SELECT
          sessions.id AS session_id,
          sessions.csrf_token AS csrf_token,
          users.id AS id,
          users.username AS username,
          users.role AS role,
          users.display_name AS display_name
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.id = ?
      `,
      [sessionId]
    );

    request.currentUser = row
      ? {
          sessionId: row.session_id,
          id: row.id,
          username: row.username,
          role: row.role,
          displayName: row.display_name
        }
      : null;

    request.csrfToken = row?.csrf_token || csrfCookie || createCsrfToken();
    if (!row?.csrf_token) {
      await db.run("UPDATE sessions SET csrf_token = ? WHERE id = ?", [request.csrfToken, sessionId]);
    }
    if (!csrfCookie) {
      response.cookie("csrf", request.csrfToken, {
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/"
      });
    }
    next();
  });

  function requireAuth(request, response, next) {
    if (!request.currentUser) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    next();
  }

  function requireCsrf(request, response, next) { //require CSRF token to be present

    const token = request.headers['x-csrf-token'] || request.body.csrfToken;
    const expectedToken = request.csrfToken;

    if (!token || token !== expectedToken) {
      response.status(403).json({ error: "CSRF token validation failed." });
      return;
    }

    next();
  }

  app.get("/", (_request, response) => sendPublicFile(response, "index.html"));
  app.get("/login", (_request, response) => sendPublicFile(response, "login.html"));
  app.get("/notes", (_request, response) => sendPublicFile(response, "notes.html"));
  app.get("/settings", (_request, response) => sendPublicFile(response, "settings.html"));
  app.get("/admin", (_request, response) => sendPublicFile(response, "admin.html"));

  app.get("/api/me", (request, response) => {
  
    response.json({ user: request.currentUser, csrfToken: request.csrfToken });
  });

  app.post("/api/login", async (request, response) => {
    const username = String(request.body.username || "");
    const password = String(request.body.password || "");

    const user = await db.get(
      "SELECT id, username, role, display_name FROM users WHERE username = ? AND password = ?",
      [username, password]
    );

    if (!user) {
      response.status(401).json({ error: "Invalid username or password." });
      return;
    }


    const sessionId = createSessionId(); //create a new session for the user and store it in the database, ensuring any existing sessions for the user are removed to prevent multiple active sessions

    await db.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
    await db.run(
      "INSERT INTO sessions (id, user_id, created_at, csrf_token) VALUES (?, ?, ?, ?)",
      [sessionId, user.id, new Date().toISOString(), request.csrfToken]
    );


    response.cookie("sid", sessionId, { //set session cookie
      httpOnly: true,  // Prevents JavaScript access to cookies
      secure: false,   // Set to true in production with HTTPS
      sameSite: "strict", // Protects against CSRF
      path: "/"
    });

    response.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.display_name
      }
    });
  });

  app.post("/api/logout", async (request, response) => {
    if (request.cookies.sid) {
      await db.run("DELETE FROM sessions WHERE id = ?", [request.cookies.sid]);
    }

    response.clearCookie("sid");
    response.json({ ok: true });
  });

  app.get("/api/notes", requireAuth, async (request, response) => { //Fetch notes (owner or asmin only)
    const ownerId = Number(request.query.ownerId || request.currentUser.id);
    

    if (ownerId !== request.currentUser.id && request.currentUser.role !== 'admin') { //Enforce access control
      response.status(403).json({ error: "Access denied." });
      return;
    }
    
    const search = String(request.query.search || "");


    const notes = await db.all(`
      SELECT
        notes.id,
        notes.owner_id AS ownerId,
        users.username AS ownerUsername,
        notes.title,
        notes.body,
        notes.pinned,
        notes.created_at AS createdAt
      FROM notes
      JOIN users ON users.id = notes.owner_id
      WHERE notes.owner_id = ?
        AND (notes.title LIKE ? OR notes.body LIKE ?)
      ORDER BY notes.pinned DESC, notes.id DESC
    `, [ownerId, `%${search}%`, `%${search}%`]);

    response.json({ notes });
  });

  app.post("/api/notes", requireAuth, requireCsrf, async (request, response) => { //Create a new note
    const title = String(request.body.title || "");
    const body = String(request.body.body || "");
    const pinned = request.body.pinned ? 1 : 0;

    const ownerId = request.currentUser.id;

    const result = await db.run(
      "INSERT INTO notes (owner_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?)",
      [ownerId, title, body, pinned, new Date().toISOString()]
    );

    response.status(201).json({
      ok: true,
      noteId: result.lastID
    });
  });

  app.get("/api/settings", requireAuth, async (request, response) => { //Fetch settings for the current user or specified user (admin only)
    const userId = Number(request.query.userId || request.currentUser.id);
    
    if (userId !== request.currentUser.id && request.currentUser.role !== 'admin') {
      response.status(403).json({ error: "Access denied." });
      return;
    }

    const settings = await db.get(
      `
        SELECT
          users.id AS userId,
          users.username,
          users.role,
          users.display_name AS displayName,
          settings.status_message AS statusMessage,
          settings.theme,
          settings.email_opt_in AS emailOptIn
        FROM settings
        JOIN users ON users.id = settings.user_id
        WHERE settings.user_id = ?
      `,
      [userId]
    );

    response.json({ settings });
  });

  app.post("/api/settings", requireAuth, requireCsrf, async (request, response) => { //Update settings
    const displayName = String(request.body.displayName || "");
    const statusMessage = String(request.body.statusMessage || "");
    const theme = String(request.body.theme || "classic");
    const emailOptIn = request.body.emailOptIn ? 1 : 0;

   
    const userId = request.currentUser.id;

    await db.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, userId]);
    await db.run(
      "UPDATE settings SET status_message = ?, theme = ?, email_opt_in = ? WHERE user_id = ?",
      [statusMessage, theme, emailOptIn, userId]
    );

    response.json({ ok: true });
  });

  app.get("/api/settings/toggle-email", requireAuth, requireCsrf, async (request, response) => { //Toggle email opt-in
    const enabled = request.query.enabled === "1" ? 1 : 0;

    await db.run("UPDATE settings SET email_opt_in = ? WHERE user_id = ?", [
      enabled,
      request.currentUser.id
    ]);

    response.json({
      ok: true,
      userId: request.currentUser.id,
      emailOptIn: enabled
    });
  });

  app.get("/api/admin/users", requireAuth, async (request, response) => { //Fetch all users (admin only)

    if (request.currentUser.role !== 'admin') {
      response.status(403).json({ error: "Admin access required." });
      return;
    }

    const users = await db.all(`
      SELECT
        users.id,
        users.username,
        users.role,
        users.display_name AS displayName,
        COUNT(notes.id) AS noteCount
      FROM users
      LEFT JOIN notes ON notes.owner_id = users.id
      GROUP BY users.id, users.username, users.role, users.display_name
      ORDER BY users.id
    `);

    response.json({ users });
  });

  return app;
}

module.exports = {
  createApp
};
