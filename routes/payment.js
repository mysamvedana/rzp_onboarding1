// server/routes/payment.js
const express = require("express");
const router = express.Router();
const { createOrder, verifyPayment, handleWebhook } = require("../controllers/razorpayController");

// These endpoints map to your existing frontend expectations:
// POST /api/create-order
// POST /api/verify-payment
// POST /api/razorpay-webhook
router.post("/create-order", createOrder);
router.post("/verify-payment", verifyPayment);
router.post("/razorpay-webhook", handleWebhook);

module.exports = router;
