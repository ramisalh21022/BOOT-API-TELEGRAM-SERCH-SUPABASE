// تأكيد الطلب
app.post('/orders/confirm', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: "order_id is required" });
    }

    const response = await axios.patch(
      `${SUPABASE_URL}/rest/v1/orders?id=eq.${order_id}`,
      { status: "confirmed" },
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }
      }
    );

    if (!response.data.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(response.data[0]);
  } catch (err) {
    console.error("confirmOrder error:", err.response?.data || err.message);
    res.status(500).send("Server Error");
  }
});
