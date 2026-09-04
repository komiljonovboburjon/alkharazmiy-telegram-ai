import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

const SEARCH_TOPICS = [
  "Milliy sertifikat",
  "Milliy sertifikat imtihonlari",
  "Milliy sertifikat natijalari",
  "Milliy sertifikat sanalari",
  "UZBMB",
  "DTM",
  "ta'lim yangiliklari",
  "abituriyent",
  "OTM",
  "kirish imtihonlari",
  "maktab ta'limi",
  "fan olimpiadalari",
  "matematika",
  "tarix",
  "ona tili",
  "fizika",
  "biologiya",
  "kimyo",
  "chet tili",
  "CEFR",
  "IELTS",
  "National Certificate",
  "education Uzbekistan"
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ...(options.headers || {})
      }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGoogleNewsRss(query) {
  const encodedQuery = encodeURIComponent(query);
  const rssUrl = `https://news.google.com/rss/search?q=${encodedQuery}&hl=uz&gl=UZ&ceid=UZ:uz`;

  try {
    const res = await fetchWithTimeout(rssUrl, {}, 8000);
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [];
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];

    for (const match of itemMatches) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/i);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

      if (titleMatch && linkMatch) {
        items.push({
          title: cleanText(titleMatch[1]),
          link: linkMatch[1].trim(),
          pubDate: pubDateMatch ? pubDateMatch[1].trim() : null
        });
      }
    }
    return items;
  } catch (err) {
    console.error("RSS Fetch Error:", query, err.message);
    return [];
  }
}

export async function resolveGoogleNewsUrl(gnewsUrl) {
  try {
    const res = await fetchWithTimeout(gnewsUrl, {}, 8000);
    if (!res.ok) return gnewsUrl;
    const html = await res.text();

    const cwMatch = html.match(/<c-wiz[^>]+data-p=["']([^"']+)["']/i);
    if (!cwMatch) return gnewsUrl;

    let rawStr = cwMatch[1].replace(/&quot;/g, '"');
    if (rawStr.startsWith("%.@.")) rawStr = rawStr.slice(4);

    let dataP;
    try {
      dataP = JSON.parse(rawStr);
    } catch {
      return gnewsUrl;
    }

    const payload = [
      [
        "FbvS2b",
        JSON.stringify(dataP),
        null,
        "generic"
      ]
    ];

    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify([payload]));

    const batchRes = await fetchWithTimeout("https://news.google.com/_/DotsDataUi/data/batchexecute?rpcids=FbvS2b", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: body.toString()
    }, 8000);

    const batchText = await batchRes.text();
    let cleanedText = batchText;
    if (cleanedText.startsWith(")]}'")) {
      cleanedText = cleanedText.substring(4).trim();
    }

    const outer = JSON.parse(cleanedText);
    for (const item of outer) {
      if (item[0] === "wrb.fr" && item[1] === "FbvS2b") {
        const innerObj = JSON.parse(item[2]);
        if (innerObj && innerObj[1]) {
          return innerObj[1];
        }
      }
    }
  } catch (e) {
    console.error("Google News redirect decoder error:", e.message);
  }
  return gnewsUrl;
}

async function scrapeOfficialGovUz() {
  const urls = [
    "https://gov.uz/oz/uzbmb/news/news",
    "https://gov.uz/uz/uzbmb/news/news",
    "https://gov.uz/oz/uzbmb",
    "https://gov.uz/uz/uzbmb"
  ];

  const foundLinks = new Set();

  for (const pageUrl of urls) {
    try {
      const res = await fetchWithTimeout(pageUrl, {}, 8000);
      if (!res.ok) continue;
      const html = await res.text();

      const patterns = [
        /\/news\/view\/(\d+)/gi,
        /news\\\/view\\\/(\d+)/gi,
        /news%2Fview%2F(\d+)/gi
      ];

      for (const pat of patterns) {
        let m;
        while ((m = pat.exec(html)) !== null) {
          foundLinks.add(`https://gov.uz/oz/uzbmb/news/view/${m[1]}`);
        }
      }
    } catch (err) {
      console.error("Gov.uz scrape error:", pageUrl, err.message);
    }
  }

  // Candidate ID probing for latest official articles
  const probeHighs = [211000, 210877, 208834];
  for (const startId of probeHighs) {
    for (let offset = 0; offset < 30; offset++) {
      const candidateId = startId - offset;
      if (candidateId > 0) {
        foundLinks.add(`https://gov.uz/oz/uzbmb/news/view/${candidateId}`);
      }
    }
  }

  return [...foundLinks];
}

async function fetchArticleDetails(targetUrl) {
  try {
    const res = await fetchWithTimeout(targetUrl, {}, 10000);
    if (!res.ok) return null;
    const html = await res.text();

    let title = null;
    const titlePatterns = [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i
    ];

    for (const pat of titlePatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        const extracted = cleanText(m[1]);
        if (extracted && !AGENCY_DEFAULT_TITLES.includes(extracted)) {
          title = extracted;
          break;
        }
      }
    }

    if (!title) return null;

    let image = null;
    const imagePatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
      /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i
    ];

    for (const pat of imagePatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        try {
          const rawImg = decodeHtmlEntities(m[1].trim());
          if (
            !rawImg.includes("google.com") &&
            !rawImg.includes("gstatic.com") &&
            !rawImg.includes("logo") &&
            !rawImg.endsWith(".ico")
          ) {
            image = new URL(rawImg, targetUrl).href;
            break;
          }
        } catch {
          image = null;
        }
      }
    }

    let canonicalUrl = targetUrl;
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    if (canonicalMatch && canonicalMatch[1]) {
      try {
        canonicalUrl = new URL(decodeHtmlEntities(canonicalMatch[1].trim()), targetUrl).href;
      } catch {
        canonicalUrl = targetUrl;
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

    for (const pat of datePatterns) {
      const m = html.match(pat);
      if (m && m[1]) {
        date = m[1];
        break;
      }
    }

    const text = cleanText(html);

    return {
      url: canonicalUrl || targetUrl,
      originalUrl: targetUrl,
      title,
      date,
      image,
      text: text.slice(0, 15000)
    };
  } catch (err) {
    console.error("Article fetch error:", targetUrl, err.message);
    return null;
  }
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

async function discoverAllNews() {
  const candidateUrls = new Set();

  // 1. Official UZBMB GOV.UZ source discovery
  const officialLinks = await scrapeOfficialGovUz();
  for (const link of officialLinks) {
    candidateUrls.add(link);
  }

  // 2. Internet-wide Google News RSS feeds discovery
  const shuffledTopics = [...SEARCH_TOPICS].sort(() => 0.5 - Math.random()).slice(0, 5);

  for (const topic of shuffledTopics) {
    const items = await fetchGoogleNewsRss(topic);
    for (const item of items) {
      if (item.link) {
        candidateUrls.add(item.link);
      }
    }
  }

  console.log("TOTAL DISCOVERED CANDIDATE LINKS:", candidateUrls.size);

  const candidateArticles = [];

  for (const link of candidateUrls) {
    if (candidateArticles.length >= 15) break;

    try {
      let targetUrl = link;

      if (link.includes("news.google.com")) {
        targetUrl = await resolveGoogleNewsUrl(link);
      }

      if (await isPosted(targetUrl)) {
        console.log("Already posted:", targetUrl);
        continue;
      }

      const details = await fetchArticleDetails(targetUrl);
      if (details && details.title && details.text && details.text.length > 150) {
        candidateArticles.push(details);
        console.log("NEW DISCOVERED ARTICLE:", details.title, "->", details.url);
      }
    } catch (err) {
      console.error("Candidate processing error:", link, err.message);
    }
  }

  return candidateArticles;
}

async function chooseNews(articles) {
  if (articles.length === 1) return articles[0];

  const data = articles.map((article, index) => ({
    index,
    title: article.title,
    date: article.date,
    url: article.url,
    hasImage: Boolean(article.image),
    isOfficialGovUz: article.url.includes("gov.uz")
  }));

  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Sen ALKHARAZMIY Telegram kanali uchun eng muhim va dolzarb ta'lim hamda Milliy Sertifikat yangiligini tanlovchi AI kontent ekspertisan.

Nomzodlar ro'yxatidan BITTA eng foydali va qiziqarli yangilikni tanla.

USTUVORLIK QOIDALARI:
1. Rasmiy UZBMB / Bilim va malakalarni baholash agentligi yangiliklari
2. Milliy sertifikat imtihon sanalari, ro'yxatdan o'tish, ruxsatnomalar, natijalar
3. Muhim ta'lim va abituriyent yangiliklari (OTM, maktab, olimpiadalar, CEFR, IELTS)
4. Yangilikning yangiligi va rasm mavjudligi

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
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Sen ALKHARAZMIY Telegram kanalining AI kontent menejerisan.

ALKHARAZMIY: ${ALKHARAZMIY_URL}
ALKHARAZMIY — turli fanlar bo'yicha Milliy Sertifikat hamda imtihonlarga tayyorlanish platformasi.
Bu faqat matematika platformasi emas!

POST QOIDALARI:
- Faqat berilgan maqoladagi haqiqiy faktlardan foydalan.
- Fakt o'ylab topma (hallucination yo'q).
- Sana, vaqt va raqamlarni o'zgartirma.
- O'zbek tilida tabiiy, qiziqarli va ravon yoz.
- O'quvchilarga nima uchun bu yangilik muhimligini tushuntir va qiziqish uyg'ot.
- Matn oxirida ALKHARAZMIY saytiga (${ALKHARAZMIY_URL}) va manba havolasiga (${article.url}) tabiiy ravishda havola ber.
- Telegram HTML formatidan foydalan (<b>bold</b>, <i>italic</i>, <a href="...">link</a>).
- Raw markdown (**bold**) ISHLATMA.

FAQAT POST MATNINI QAYTAR.`
        },
        {
          role: "user",
          content: `MANBA URL: ${article.url}
SANA: ${article.date || "Noma'lum"}
SARLAVHA: ${article.title}
MAQOLA MATNI: ${article.text}

Shu maqola asosida ALKHARAZMIY Telegram kanali uchun bitta ajoyib post yoz.`
        }
      ],
      temperature: 0.7,
      max_tokens: 700
    });

    return completion.choices[0]?.message?.content?.trim() || escapeHtml(article.title);
  } catch (err) {
    console.error("Groq generate post error:", err.message);
    return `<b>${escapeHtml(article.title)}</b>\n\nBatafsil ma'lumot: <a href="${article.url}">${escapeHtml(article.title)}</a>\n\nTayyorgarlik: <a href="${ALKHARAZMIY_URL}">ALKHARAZMIY</a>`;
  }
}

export function truncateCaption(caption, maxLen = 1024) {
  if (!caption || caption.length <= maxLen) return caption;
  // Strip tags first for photo caption truncation to avoid leaving broken unclosed HTML tags
  const plain = caption.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= maxLen) return plain;

  const truncated = plain.slice(0, maxLen - 4);
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

    const articles = await discoverAllNews();

    if (!articles.length) {
      console.log("CRON RESULT: Yangi rasmiy/internet yangilik topilmadi.");
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
