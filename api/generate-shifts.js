// Legacy automatic rota writes are replaced by explicit, authenticated publishing.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res
    .status(410)
    .json({
      reply: "Open the Shift planner to review and publish shifts.",
      url: "/shifts-admin.html",
    });
}
