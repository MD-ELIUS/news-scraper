const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://www.dailyamardesh.com";
const URL = BASE_URL + "/latest";

const WEBHOOK_URL = "https://n8n-0g84.onrender.com/webhook/news";

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
    "০":"0","১":"1","২":"2","৩":"3","৪":"4",
    "৫":"5","৬":"6","৭":"7","৮":"8","৯":"9"
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

function timeToMinutes(t) {
  if (!t) return -1;
  return t.hour * 60 + t.min;
}

// ==========================
// CHECK 10 MIN RULE
// ==========================

function isWithin10Min(text) {
  const t = extractTime(text);

  if (!t) {
    console.log("⛔ No time found → SKIP");
    return false;
  }

  const now = getBDNow();

  const newsTime = new Date(now);
  newsTime.setHours(t.hour);
  newsTime.setMinutes(t.min);
  newsTime.setSeconds(0);

  const diffMin = (now - newsTime) / 60000;

  console.log("🇧🇩 BD NOW:", now.toLocaleTimeString());
  console.log("⏱ AGE:", diffMin.toFixed(2), "min");

  return diffMin >= 0 && diffMin <= 10;
}

// ==========================
// SCRAPE LIST
// ==========================

async function scrapeNews() {
  try {
    console.log("🚀 Scraping started...");

    const { data } = await axios.get(URL, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

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

    console.log("📦 Total scraped:", newsList.length);

    // ==========================
    // DETAILS FETCH + TIME ATTACH
    // ==========================

    for (let i = 0; i < newsList.length; i++) {
      const details = await scrapeDetails(newsList[i].link);

      newsList[i].description = details.description;
      newsList[i].image = details.image;

      const t = extractTime(details.description);
      newsList[i].timeValue = timeToMinutes(t);

      console.log("📰 Parsed:", newsList[i].title, "→", newsList[i].timeValue);
    }

    // ==========================
    // 🔥 FIXED SORT (LATEST FIRST)
    // ==========================

    newsList.sort((a, b) => {
      const timeA = a.timeValue === -1 ? -Infinity : a.timeValue;
      const timeB = b.timeValue === -1 ? -Infinity : b.timeValue;

      return timeA - timeB;
    });

    console.log("\n✅ SORT DONE\n");

    // ==========================
    // SEND FILTERED NEWS
    // ==========================

    for (let i = 0; i < newsList.length; i++) {
      const news = newsList[i];

      console.log("\n=====================");
      console.log("📰 TITLE:", news.title);
      console.log("📝 DESC:", news.description);
      console.log("🖼 IMAGE:", news.image);

      if (!isWithin10Min(news.description)) {
        console.log("⛔ SKIPPED (OLD NEWS)");
        continue;
      }

      await sendToN8N({
        title: news.title,
        link: news.link,
        description: news.description,
        image: news.image
      });
    }

    console.log("\n🎉 DONE!");

  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}

// ==========================
// DETAILS SCRAPER
// ==========================

async function scrapeDetails(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);

    const paragraphs = $("article p")
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(p => p.length > 30);

    const description = paragraphs.slice(0, 2).join(" ");

    const image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $("article img").first().attr("src") ||
      "";

    return { description, image };

  } catch (err) {
    return { description: "", image: "" };
  }
}

// ==========================
// SEND TO N8N
// ==========================

async function sendToN8N(news) {
  try {
    await axios.post(WEBHOOK_URL, news);
    console.log("📤 SENT:", news.title);
  } catch (err) {
    console.log("❌ N8N ERROR:", err.message);
  }
}

// RUN
if (require.main === module) {
  scrapeNews();
}

module.exports = scrapeNews;