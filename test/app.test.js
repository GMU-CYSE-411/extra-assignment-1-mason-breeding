// Required modules for testing
const fs = require("fs"); // File system operations
const path = require("path"); // Path utilities
const request = require("supertest"); // HTTP assertion library for testing Express apps
const { expect } = require("chai"); // Assertion library
const { openDatabase } = require("../db"); // Database module
const { createApp } = require("../server/app"); // Express app factory

// Path to the temporary test database file
const TEST_DB_FILE = path.join(__dirname, "test-training-lab.sqlite");

/**
 * Initialize a test database with known data for testing secure server behavior.
 * Creates all necessary tables and populates them with test users, notes, and settings.
 */
async function initializeTestDatabase() {
  // Remove existing test database if it exists (clean slate for tests)
  if (fs.existsSync(TEST_DB_FILE)) {
    fs.unlinkSync(TEST_DB_FILE);
  }

  const db = openDatabase(TEST_DB_FILE);

  // Create all required tables with their schema

  await db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      csrf_token TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    )
  `);

  await db.run(`
    CREATE TABLE settings (
      user_id INTEGER PRIMARY KEY,
      status_message TEXT NOT NULL,
      theme TEXT NOT NULL,
      email_opt_in INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  await db.run(
    "INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
    [
      "admin",
      "admin123",
      "admin",
      "Administrator",
      "alice",
      "wonderland",
      "student",
      "Alice Analyst",
      "bob",
      "builder",
      "student",
      "Bob Builder"
    ]
  );

  // Insert user settings for each user
  await db.run(
    "INSERT INTO settings (user_id, status_message, theme, email_opt_in) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
    [
      1,
      "I review every note before class.",
      "classic",
      1,
      2,
      "Looking for trust boundary examples.",
      "ocean",
      1,
      3,
      "Need help with the admin checklist.",
      "forest",
      0
    ]
  );

  // Insert sample notes owned by different users
  await db.run(
    "INSERT INTO notes (owner_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
    [
      1,
      "Instructor checklist",
      "Review the settings flow before publishing the lab.",
      1,
      "2026-04-10T10:00:00.000Z",
      2,
      "DOM reminder",
      "Never trust browser-rendered HTML from note content.",
      0,
      "2026-04-10T11:00:00.000Z",
      2,
      "Study idea",
      "<strong>Reflection prompt:</strong> where does the browser interpret data as code?",
      0,
      "2026-04-11T09:15:00.000Z",
      3,
      "Lab question",
      "Can a normal user reach /admin if the client hides the link?",
      0,
      "2026-04-11T09:20:00.000Z"
    ]
  );

  await db.close();
}

// Test suite for secure server behavior
describe("Secure server behavior", function () {
  let app; // Express app instance
  let aliceAgent; // Supertest agent for Alice (admin user)
  let bobAgent; // Supertest agent for Bob (student user)

  // Setup: Run before all tests
  before(async function () {
    await initializeTestDatabase(); // Create and populate test database
    app = await createApp(TEST_DB_FILE); // Initialize Express app with test database
    aliceAgent = request.agent(app); // Create agent for Alice (maintains cookies across requests)
    bobAgent = request.agent(app); // Create agent for Bob (maintains cookies across requests)
  });

  // Cleanup: Run after all tests
  after(function () {
    // Remove test database file
    if (fs.existsSync(TEST_DB_FILE)) {
      fs.unlinkSync(TEST_DB_FILE);
    }
  });

  // TEST 1: Verify SQL injection vulnerability is patched
  // Attempts to login using a SQL injection payload in the username field
  // Expected: Request should be rejected with 401 status and error message
  it("rejects SQL injection login attempts", async function () {
    const response = await request(app)
      .post("/api/login")
      .send({ username: "' OR '1'='1", password: "" })
      .set("Accept", "application/json");

    expect(response.status).to.equal(401);
    expect(response.body).to.have.property("error");
  });

  // TEST 2: Verify session cookies have security flags
  // Logs in with valid credentials and checks that the session cookie includes:
  // - HttpOnly flag (prevents JavaScript access)
  // - SameSite=Strict flag (prevents CSRF attacks)
  it("sets a secure session cookie on successful login", async function () {
    const response = await aliceAgent
      .post("/api/login")
      .send({ username: "alice", password: "wonderland" })
      .set("Accept", "application/json");

    expect(response.status).to.equal(200);
    expect(response.body).to.have.nested.property("user.username", "alice");

    // Verify cookie has security flags
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).to.be.an("array");
    expect(setCookie.some((value) => value.includes("sid=") && value.includes("HttpOnly") && value.includes("SameSite=Strict"))).to.be.true;
  });

  // TEST 3: Verify CSRF protection is implemented
  // Retrieves a CSRF token, then attempts to create a note without it (should fail)
  // Then creates a note with a valid CSRF token (should succeed)
  it("requires a valid CSRF token for note creation and accepts valid token", async function () {
    // Get CSRF token from /api/me endpoint
    const meResponse = await aliceAgent.get("/api/me").set("Accept", "application/json");
    expect(meResponse.status).to.equal(200);
    expect(meResponse.body).to.have.property("csrfToken");
    const csrfToken = meResponse.body.csrfToken;

    // Attempt to create note without CSRF token - should be rejected with 403
    const missingCsrf = await aliceAgent
      .post("/api/notes")
      .send({ title: "Unsafe note", body: "Should not be accepted.", pinned: 0 })
      .set("Accept", "application/json");
    expect(missingCsrf.status).to.equal(403);

    // Create note with valid CSRF token - should succeed with 201
    const validCsrf = await aliceAgent
      .post("/api/notes")
      .send({ title: "Safe note", body: "CSRF protection in place.", pinned: 0 })
      .set("Accept", "application/json")
      .set("X-CSRF-Token", csrfToken);

    expect(validCsrf.status).to.equal(201);
    expect(validCsrf.body).to.have.property("noteId");
  });

  // TEST 4: Verify authorization checks prevent students from accessing admin endpoints
  // Logs in as Bob (student), then attempts to access /api/admin/users
  // Expected: Request should be rejected with 403 (Forbidden) status
  it("forbids non-admin users from accessing admin endpoints", async function () {
    // Login as Bob (student user)
    const loginResponse = await bobAgent
      .post("/api/login")
      .send({ username: "bob", password: "builder" })
      .set("Accept", "application/json");

    expect(loginResponse.status).to.equal(200);
    
    // Try to access admin endpoint - should be rejected
    const adminResponse = await bobAgent.get("/api/admin/users").set("Accept", "application/json");
    expect(adminResponse.status).to.equal(403);
    expect(adminResponse.body).to.have.property("error");
  });

  // TEST 5: Verify authorization checks prevent unauthorized note access
  // Bob (student) is already logged in from previous test
  // Attempts to read notes owned by user ID 1 (admin)
  // Expected: Request should be rejected with 403 (Forbidden) status
  it("prevents students from reading another user's notes", async function () {
    const notesResponse = await bobAgent
      .get("/api/notes")
      .query({ ownerId: 1 }) // Try to read admin's notes
      .set("Accept", "application/json");

    expect(notesResponse.status).to.equal(403);
    expect(notesResponse.body).to.have.property("error");
  });
});
