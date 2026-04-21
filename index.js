const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3008;

const BASE_URL = "https://www.dailyamardesh.com";
const URL = BASE_URL + "/latest";

// এনভায়রনমেন্ট ভেরিয়েবল
const WEBHOOK_URL = process.env.WEBHOOK_URL ;
const SCRAPER_KEY = process.env.SCRAPER_KEY ;

// Axios instance with 60s timeout for scraping
const scrapeAxios = axios.create({
  timeout: 60000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
  }
});

// Axios instance with 30s timeout for webhook
const webhookAxios = axios.create({
  timeout: 30000
});

app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.send("Amar Desh Scraper is running!");
});

// ==========================
// 🇧🇩 BD TIME HELPERS
// ==========================

function getBDNow() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" }));
}

function extractTime(text) {
  if (!text) return null;

  const bnToEn = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9"
  };

  let cleanText = text
    .replace(/[০-৯]/g, d => bnToEn[d])
    .replace(/\u00A0/g, " ")
    .replace(/：/g, ":")
    .replace(/\s+/g, " ");

  const match = cleanText.match(/(\d{1,2})\s*:\s*(\d{1,2})/);

  if (!match) return null;

  const hour = parseInt(match[1]);
  const min = parseInt(match[2]);

  if (hour > 23 || min > 59) return null;

  return { hour, min };
}

function isWithinLimit(text, limit = 2) {
  const t = extractTime(text);
  if (!t) return false;

  const now = getBDNow();
  const newsTime = new Date(now);
  newsTime.setHours(t.hour);
  newsTime.setMinutes(t.min);
  newsTime.setSeconds(0);

  if (newsTime > now) {
    newsTime.setDate(newsTime.getDate() - 1);
  }

  const diffMin = (now - newsTime) / 60000;
  return diffMin >= 0 && diffMin <= limit;
}

// ==========================
// SCRAPE LOGIC
// ==========================

async function scrapeNews() {
  try {
    console.log("🚀 Scraping started...");
    const { data } = await scrapeAxios.get(URL);
    const $ = cheerio.load(data);

    const newsList = [];
    $("article").each((i, el) => {
      const title = $(el).find("h2 span").text().trim();
      const link = $(el).find("a").attr("href");
      if (title && link) {
        newsList.push({
          title,
          link: BASE_URL + link
        });
      }
    });

    console.log("📦 Total discovered:", newsList.length);

    const recentList = newsList;
    const processed = [];

    for (let i = 0; i < recentList.length; i++) {
      const item = recentList[i];
      console.log(`\n[${i + 1}/${recentList.length}] 📰 ${item.title}`);

      const details = await scrapeDetails(item.link);
      const t = extractTime(details.description);

      if (t) {
        if (!isWithinLimit(details.description, 10)) {
          console.log("⛔ SKIPPED (OLD NEWS)");
          continue;
        }

        console.log("✅ SENDING TO WEBHOOK...");
        const payload = {
          title: item.title,
          description: details.description,
          link: item.link,
          image: details.image || "",
          source: "dailyamardesh",
          sourceBangla: "দৈনিক আমার দেশ",
          sourceTime: details.sourceTime
        };

        await sendToWebhook(payload);
        processed.push(payload);
      } else {
        console.log("⛔ No time found — skipping");
      }
    }

    return processed;
  } catch (err) {
    console.error("❌ Scrape Error:", err.message);
    throw err;
  }
}

async function scrapeDetails(url) {
  try {
    const { data } = await scrapeAxios.get(url);
    const $ = cheerio.load(data);

    const paragraphs = $("article p")
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(p => p.length > 30);

    const description = paragraphs.join(" ");
    const firstParagraph = paragraphs[0] || "";
    const timeObj = extractTime(firstParagraph);

    let sourceTime = new Date().toISOString();
    if (timeObj) {
      const now = getBDNow();
      const articleTime = new Date(now);
      articleTime.setHours(timeObj.hour);
      articleTime.setMinutes(timeObj.min);
      articleTime.setSeconds(0);
      sourceTime = articleTime.toISOString();
    }

    const image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $("article img").first().attr("src") ||
      "";

    return { description, image, sourceTime };
  } catch (err) {
    return { description: "", image: "", sourceTime: new Date().toISOString() };
  }
}

async function sendToWebhook(news) {
  if (!WEBHOOK_URL) {
    console.log("⚠️ WEBHOOK_URL not set, skipping send");
    return;
  }
  try {
    await webhookAxios.post(WEBHOOK_URL, news);
    console.log("📤 SENT SUCCESSFULLY");
  } catch (err) {
    console.log("❌ WEBHOOK ERROR:", err.message);
  }
}

// ==========================
// ENDPOINTS
// ==========================

app.get("/scrape", async (req, res) => {
  const key = req.query.key || req.headers["x-scraper-key"];

  if (SCRAPER_KEY && key !== SCRAPER_KEY) {
    console.log("🔒 Unauthorized access attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const data = await scrapeNews();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Endpoint: http://localhost:${PORT}/scrape`);
});
