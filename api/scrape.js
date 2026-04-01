const scrapeNews = require("../index");

export default async function handler(req, res) {
  // Security check: Match key from query parameter with environment variable
  const { key } = req.query;
  const SECRET_KEY = process.env.CRON_SECRET;

  if (SECRET_KEY && key !== SECRET_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("Triggered news scraping via API");
    await scrapeNews();
    res.status(200).json({ success: true, message: "Scraping completed successfully" });
  } catch (error) {
    console.error("Scraping failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
}
