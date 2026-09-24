// Authenticated proxy for the Hayle waste counter's shared datastore.
// Implemented by the waste feature.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(501).json({ ok: false, error: "Waste sync is not available yet." });
}
