// server/controllers/razorpayController.js
const Razorpay = require("razorpay");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize Firebase Admin (supports GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON)
if (!admin.apps.length) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
  } else {
    console.warn("Firebase not initialized: set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON");
  }
}
const db = admin && typeof admin.firestore === "function" ? admin.firestore() : null;


// Razorpay client
const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET,
});

/**
 * Create order
 * POST /api/create-order
 * body: { amountInPaise: number, receipt?: string, notes?: object }
 */
async function createOrder(req, res) {
  try {
    const { amountInPaise, receipt = `rcpt_${Date.now()}`, notes = {} } = req.body;
    if (!amountInPaise || typeof amountInPaise !== "number") {
      return res.status(400).json({ error: "amountInPaise (number) required (paise)" });
    }

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt,
      payment_capture: parseInt(process.env.DEFAULT_PAYMENT_CAPTURE || "1", 10),
      notes,
    };

    const order = await razorpay.orders.create(options);

    if (db) {
      await db.collection("razorpay-orders").doc(order.id).set({
        order,
        notes,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return res.json({ order });
  } catch (err) {
    console.error("createOrder error:", err);
    return res.status(500).json({ error: "create-order-failed", detail: err.message });
  }
}

/**
 * Verify payment
 * POST /api/verify-payment
 * body: { razorpay_payment_id, razorpay_order_id, razorpay_signature, amountInPaise, member? }
 */
async function verifyPayment(req, res) {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, amountInPaise, member } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ error: "payment_id, order_id, signature required" });
    }

    // verify signature server-side
    const expected = crypto
      .createHmac("sha256", process.env.RZP_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      console.warn("Signature mismatch", { expected, razorpay_signature });
      return res.status(400).json({ error: "invalid signature" });
    }

    // capture if manual
    const defaultCapture = parseInt(process.env.DEFAULT_PAYMENT_CAPTURE || "1", 10);
    if (amountInPaise && defaultCapture === 0) {
      try {
        await razorpay.payments.capture(razorpay_payment_id, amountInPaise, "INR");
      } catch (captureErr) {
        console.warn("capture error (may already be captured):", captureErr.message);
      }
    }

    if (db) {
      await db.collection("razorpay-orders").doc(razorpay_order_id).set({
        paymentId: razorpay_payment_id,
        verified: true,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        member: member || null,
      }, { merge: true });

      if (member && member.memberId) {
        await db.collection("samvedana-members").doc(member.memberId).set({
          paymentStatus: "Success",
          razorpay: {
            order_id: razorpay_order_id,
            payment_id: razorpay_payment_id,
          }
        }, { merge: true });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("verifyPayment error:", err);
    return res.status(500).json({ error: err.message });
  }
}

/**
 * Webhook handler
 * POST /api/razorpay-webhook  (raw body required)
 */
async function handleWebhook(req, res) {
  try {
    const webhookSecret = process.env.RZP_WEBHOOK_SECRET || "";
    const signature = req.headers["x-razorpay-signature"];
    const body = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body || {});
    const expected = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
    if (signature !== expected) {
      console.warn("webhook signature mismatch");
      return res.status(400).send("invalid signature");
    }

    const event = req.body.event;
    if (event === "payment.captured") {
      const payload = req.body.payload.payment.entity;
      if (db) {
        await db.collection("razorpay-webhooks").doc(payload.id).set({
          event,
          payload,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("webhook handler error:", err);
    res.status(500).send("error");
  }
}

module.exports = {
  createOrder,
  verifyPayment,
  handleWebhook,
};
