import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

const GOV_PAGES = [
  "https://gov.uz/oz/uzbmb",
  "https://gov.uz/oz/uzbmb/news/news",
  "https://gov.uz/uz/uzbmb",
  "https://gov.uz/uz/uzbmb/news/news"
];

const AGENCY_DEFAULT_TITLES = [
  "O'zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi huzuridagi Bilim va malakalarni baholash agentligi",
  "O‘zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi huzuridagi Bilim va malakalarni baholash agentligi",
  "Ўзбекистон Республикаси Олий таълим, фан ва инновациялар вазирлиги ҳузуридаги Билим ва малакаларни баҳолаш агентлиги"
];

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

export function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cleanText(html) {
  if (!html) return "";
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeHtmlEntities(cleaned);
}

async function fetchPage(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractNewsIdsFromText(text) {
  const ids = new Set();
  const patterns = [
    /\/news\/view\/(\d+)/gi,
    /news\\\/view\\\/(\d+)/gi,
    /news%2Fview%2F(\d+)/gi,
    /\"id\":\s*(\d+)/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

async function probeRecentArticleIds() {
  const probedIds = new Set();
  // Probe a range of candidate article IDs downwards around latest known IDs
  const knownHighs = [211000, 210877, 208834];

  for (const startId of knownHighs) {
    for (let offset = 0; offset < 35; offset++) {
      const candidateId = startId - offset;
      if (candidateId <= 0) continue;
      probedIds.add(String(candidateId));
    }
  }

  return [...probedIds];
}

async function getNewsLinks() {
  const allIds = new Set();

  for (const url of GOV_PAGES) {
    try {
      const html = await fetchPage(url);
      const ids = extractNewsIdsFromText(html);
      for (const id of ids) {
        allIds.add(id);
      }
    } catch (error) {
      console.error("PAGE SCRAPE ERROR:", url, error.message);
    }
  }

  // Also probe candidate article IDs
  const probed = await probeRecentArticleIds();
  for (const id of probed) {
    allIds.add(id);
  }

  console.log("JAMI CANDIDATE NEWS IDs:", allIds.size);
  return [...allIds].map((id) => `https://gov.uz/oz/uzbmb/news/view/${id}`);
}

async function getArticle(url) {
  const html = await fetchPage(url);

  let title = null;
  const titlePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const extracted = cleanText(match[1]);
      if (extracted && !AGENCY_DEFAULT_TITLES.includes(extracted)) {
        title = extracted;
        break;
      }
    }
  }

  if (!title) {
    return null;
  }

  let image = null;
  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];

  for (const pattern of imagePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      try {
        const rawImg = decodeHtmlEntities(match[1].trim());
        image = new URL(rawImg, url).href;
        break;
      } catch {
        image = null;
      }
    }
  }

  let date = null;
  const datePatterns = [
    /"date"\s*:\s*"([^"]+)"/i,
    /datetime=["']([^"']+)["']/i,
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}\.\d{2}\.\d{4})/
  ];

  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      date = match[1];
      break;
    }
  }

  const text = cleanText(html);

  return {
    url,
    title,
    date,
    image,
    text: text.slice(0, 18000)
  };
}

async function supabaseRequest(endpoint, options = {}, retry = true) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("Supabase credentials not configured.");
    return null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase ${response.status}: ${body}`);
    }

    return response;
  } catch (error) {
    if (retry) {
      console.error("SUPABASE RETRY:", endpoint, error.message);
      return supabaseRequest(endpoint, options, false);
    }
    throw error;
  }
}

async function isPosted(url) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const encoded = encodeURIComponent(url);
  const response = await supabaseRequest(
    `telegram_posts?source_url=eq.${encoded}&select=id`
  );
  if (!response) return false;
  const data = await response.json();
  return Array.isArray(data) && data.length > 0;
}

async function savePost(article) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await supabaseRequest("telegram_posts", {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates"
    },
    body: JSON.stringify({
      source_url: article.url,
      title: article.title,
      image_url: article.image
    })
  });
}

async function getArticles() {
  const links = await getNewsLinks();
  console.log("TOTAL CANDIDATE NEWS LINKS:", links.length);

  const articles = [];
  for (const link of links) {
    if (articles.length >= 10) break;
    try {
      if (await isPosted(link)) {
        console.log("Already posted:", link);
        continue;
      }

      const article = await getArticle(link);
      if (article && article.title && article.text) {
        articles.push(article);
        console.log("NEW VALID ARTICLE:", article.title);
      } else {
        console.log("SKIP (invalid/default title):", link);
      }
    } catch (error) {
      console.error("ARTICLE FETCH ERROR:", link, error.message);
    }
  }

  return articles;
}

async function chooseNews(articles) {
  if (articles.length === 1) return articles[0];

  const data = articles.map((article, index) => ({
    index,
    title: article.title,
    date: article.date,
    url: article.url
  }));

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Sen ALKHARAZMIY Telegram kanalining yangilik tanlovchisisan.
Barcha maqolalar rasmiy Bilim va malakalarni baholash agentligi manbasidan olingan.
BITTA eng foydali va muhim yangilikni tanla.

Ustuvorlik:
1. Milliy Sertifikat bilan bog'liq yangiliklar
2. Imtihon sanasi
3. Ro'yxatdan o'tish
4. Ruxsatnoma / Admission documents
5. Natijalar
6. Muhim rasmiy o'zgarishlar
7. Ariza topshiruvchilar uchun foydali axborot

Eslatma: ALKHARAZMIY faqat matematika emas, barcha Milliy Sertifikat fanlari bo'yicha tayyorgarlik platformasi.

Faqat JSON qaytar:
{"index":0}
Boshqa hech narsa yozma.`
        },
        {
          role: "user",
          content: JSON.stringify(data)
        }
      ],
      temperature: 0.1,
      max_tokens: 50
    });

    const rawContent = completion.choices[0]?.message?.content?.trim() || "";
    const result = JSON.parse(rawContent);

    if (Number.isInteger(result.index) && articles[result.index]) {
      return articles[result.index];
    }
  } catch (error) {
    console.error("AI SELECT ERROR:", error.message);
  }

  return articles[0];
}

async function generatePost(article) {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

ALKHARAZMIY: ${ALKHARAZMIY_URL}
ALKHARAZMIY — turli fanlar bo'yicha Milliy Sertifikat imtihonlariga tayyorlanish platformasi.
Bu faqat matematika platformasi emas.

POST QOIDALARI:
- Faqat rasmiy maqoladagi faktlardan foydalan.
- Fakt o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- O'zbek tilida, tabiiy va ravon yoz.
- Muhim va foydali ma'lumotlarni qisqa paragraflarda ber.
- Emoji me'yorida ishlat.
- Clickbait va bo'rttirish ishlatma.
- ALKHARAZMIY saytiga (${ALKHARAZMIY_URL}) tabiiy ravishda qiziqtirib havola ber.
- Telegram HTML formatidan foydalansang bo'ladi (<b>bold</b>, <i>italic</i>, <a href="...">link</a>).
- Raw markdown (**bold**) ISHLATMA.

FAQAT POST MATNINI QAYTAR.`
      },
      {
        role: "user",
        content: `RASMIY MANBA: ${article.url}
SANA: ${article.date || "Noma'lum"}
SARLAVHA: ${article.title}
MAQOLA: ${article.text}

Shu rasmiy maqola asosida ALKHARAZMIY Telegram kanali uchun bitta qiziqarli post yoz.`
      }
    ],
    temperature: 0.7,
    max_tokens: 700
  });

  return completion.choices[0]?.message?.content?.trim() || article.title;
}

export function truncateCaption(caption, maxLen = 1024) {
  if (!caption || caption.length <= maxLen) return caption;
  const truncated = caption.slice(0, maxLen - 4);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen - 100) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

async function sendTelegram(post, image) {
  if (!TELEGRAM_TOKEN || !CHANNEL_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID must be configured.");
  }

  const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  if (image) {
    try {
      const caption = truncateCaption(post, 1024);
      const response = await fetch(`${base}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: image,
          caption,
          parse_mode: "HTML"
        })
      });

      const result = await response.json();
      if (result.ok) {
        return result;
      }
      console.error("sendPhoto failed:", result);
    } catch (error) {
      console.error("sendPhoto NETWORK ERROR:", error.message);
    }
  }

  // Fallback to sendMessage
  const response = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text: post,
      parse_mode: "HTML",
      disable_web_page_preview: false
    })
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.description || "Telegram sendMessage error");
  }

  return result;
}

export default async function handler(req, res) {
  try {
    console.log("ALKHARAZMIY CRON STARTED", new Date().toISOString());

    const articles = await getArticles();

    if (!articles.length) {
      console.log("CRON RESULT: Yangi rasmiy yangilik topilmadi.");
      return res.status(200).json({
        success: true,
        message: "Yangi rasmiy yangilik topilmadi. Post yuborilmadi."
      });
    }

    const selected = await chooseNews(articles);
    const post = await generatePost(selected);

    await sendTelegram(post, selected.image);
    await savePost(selected);

    console.log("CRON RESULT: Post successfully sent:", selected.url);

    return res.status(200).json({
      success: true,
      message: "Telegram post sent successfully",
      source: selected.url,
      title: selected.title,
      date: selected.date,
      image: selected.image,
      post
    });
  } catch (error) {
    console.error("CRON ERROR:", error.message);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
