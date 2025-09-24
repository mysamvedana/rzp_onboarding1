// server/index.js
require("dotenv").config();
const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const os = require("os");

// optionally write FIREBASE_SERVICE_ACCOUNT_JSON to a temp file so firebase-admin can use it
if (
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
  !process.env.GOOGLE_APPLICATION_CREDENTIALS
) {
  try {
    const tmpDir = os.tmpdir(); // cross-platform temp directory
    const tmpPath = path.join(tmpDir, "/tmp/serviceAccountKey.json");
    fs.writeFileSync(tmpPath, process.env.FIREBASE_SERVICE_ACCOUNT_JSON, {
      mode: 0o600,
    });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
    console.log("Wrote FIREBASE_SERVICE_ACCOUNT_JSON to", tmpPath);
  } catch (e) {
    console.error(
      "Failed to write FIREBASE_SERVICE_ACCOUNT_JSON to temp file:",
      e
    );
    // Do not crash — admin init may still work via JSON parsing path below
  }
}

const app = express();

// preserve raw body for webhook signature verification
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// CORS - restrict to configured frontend origin
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: FRONTEND_ORIGIN }));

// Basic health endpoint
app.get("/health", (req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "development" })
);

// Initialize Firebase Admin
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    console.log(
      "Firebase admin initialized using GOOGLE_APPLICATION_CREDENTIALS"
    );
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log(
      "Firebase admin initialized using FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  } else {
    console.warn(
      "Firebase admin not initialized: set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON"
    );
  }
} catch (e) {
  console.error("Firebase initialization error:", e);
}

const db =
  admin && typeof admin.firestore === "function" ? admin.firestore() : null;

// Initialize Razorpay client (used by controller/router)
const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,
});

// Mount payment router
const paymentRoutes = require("./routes/payment");
app.use("/api", paymentRoutes);

// Generic error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal_server_error", detail: err.message });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
