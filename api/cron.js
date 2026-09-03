import Groq from "groq-sdk";

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

const GOV_PAGES = [
  "https://gov.uz/oz/uzbmb/news/news",
  "https://gov.uz/uz/uzbmb/news/news",
  "https://gov.uz/oz/uzbmb",
  "https://gov.uz/uz/uzbmb"
];

const AGENCY_DEFAULT_TITLES = [
  "O'zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi huzuridagi Bilim va malakalarni baholash agentligi",
  "O‘zbekiston Respublikasi Oliy ta’lim, fan va innovatsiyalar vazirligi huzuridagi Bilim va malakalarni baholash agentligi",
  "Ўзбекистон Республикаси Олий таълим, фан ва инновациялар вазирлиги ҳузуридаги Билим ва малакаларни баҳолаш агентлиги",
  "O‘zbekiston Respublikasi Hukumat portali",
  "Ўзбекистон Республикаси Ҳукумат портали"
];

const POST_STYLES = [
  "A. Rasmiy tezkor xabar / Muhim yangilik",
  "B. Imtihonga tayyorgarlik va sertifikat bo'yicha amaliy maslahat",
  "C. 'Bilasizmi?' / Muhim tushuntirish formati",
  "D. Rasmiy e'lon va muddatlar xulosasi",
  "E. Muhim eslatma va savol-javob shakli"
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

function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const urlObj = new URL(rawUrl);
    urlObj.hash = "";
    urlObj.search = "";
    let str = urlObj.toString();
    if (str.endsWith("/")) str = str.slice(0, -1);
    return str;
  } catch {
    return rawUrl.trim();
  }
}

async function fetchPage(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
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
    /\b(21\d{4})\b/g,
    /\b(20\d{4})\b/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) ids.add(match[1]);
    }
  }

  return [...ids];
}

async function probeRecentArticleIds() {
  const probedIds = new Set();
  const knownHighs = [214451, 213680, 213670, 212746, 210877, 208834];

  for (const startId of knownHighs) {
    for (let offset = 0; offset <= 25; offset++) {
      const candidateId = startId - offset;
      if (candidateId > 0) probedIds.add(String(candidateId));
    }
  }

  return [...probedIds];
}

async function getGovUzArticles() {
  const candidateIds = new Set();

  for (const pageUrl of GOV_PAGES) {
    try {
      const html = await fetchPage(pageUrl);
      const ids = extractNewsIdsFromText(html);
      for (const id of ids) candidateIds.add(id);
    } catch (error) {
      console.error("GOV.UZ SCRAPE ERROR:", pageUrl, error.message);
    }
  }

  const probed = await probeRecentArticleIds();
  for (const id of probed) candidateIds.add(id);

  console.log("TOTAL GOV.UZ CANDIDATE IDs:", candidateIds.size);

  const articles = [];
  const sortedIds = [...candidateIds].sort((a, b) => Number(b) - Number(a));

  for (const id of sortedIds) {
    if (articles.length >= 8) break;
    const url = `https://gov.uz/oz/uzbmb/news/view/${id}`;
    const normalized = normalizeUrl(url);

    try {
      if (await isPosted(normalized)) {
        console.log("Already posted GOV article:", normalized);
        continue;
      }

      const article = await getGovArticle(url);
      if (article && article.title && article.text && article.text.length > 50) {
        articles.push(article);
        console.log("NEW VALID GOV ARTICLE:", article.title);
      }
    } catch (error) {
      console.error("GOV ARTICLE FETCH ERROR:", url, error.message);
    }
  }

  return articles;
}

async function getGovArticle(url) {
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

  if (!title) return null;

  let image = null;
  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
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
    url: normalizeUrl(url),
    raw_url: url,
    source: "UZBMB Official Website (gov.uz)",
    title,
    date,
    image,
    text: text.slice(0, 15000)
  };
}

async function getTelegramChannelArticles(channelUsername) {
  const webUrl = `https://t.me/s/${channelUsername}`;
  const articles = [];

  try {
    const html = await fetchPage(webUrl);
    const messages = html.split('<div class="tgme_widget_message ');

    for (let i = messages.length - 1; i >= 1; i--) {
      if (articles.length >= 5) break;

      const msgBlock = messages[i];

      const linkMatch = msgBlock.match(/href="(https:\/\/t\.me\/[^\/]+\/\d+)"/);
      if (!linkMatch) continue;

      const postUrl = normalizeUrl(linkMatch[1]);
      if (await isPosted(postUrl)) continue;

      const timeMatch = msgBlock.match(/<time[^>]+datetime="([^"]+)"/);
      const date = timeMatch ? timeMatch[1] : null;

      const textMatch = msgBlock.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      let text = "";
      if (textMatch) {
        text = decodeHtmlEntities(
          textMatch[1]
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        );
      }

      if (!text || text.length < 40) continue;

      const photoMatch = msgBlock.match(/background-image:url\('([^']+)'\)/);
      let image = photoMatch ? photoMatch[1] : null;
      if (image && image.startsWith("//")) image = "https:" + image;

      const title = text.split("\n")[0].slice(0, 100);

      articles.push({
        url: postUrl,
        raw_url: linkMatch[1],
        source: `@${channelUsername} (Official Telegram)`,
        title,
        date,
        image,
        text
      });
    }
  } catch (error) {
    console.error(`TELEGRAM SCRAPE ERROR (@${channelUsername}):`, error.message);
  }

  return articles;
}

async function supabaseRequest(endpoint, options = {}, retry = true) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  const normalized = normalizeUrl(url);
  const encoded = encodeURIComponent(normalized);
  const response = await supabaseRequest(
    `telegram_posts?source_url=eq.${encoded}&select=id`
  );
  if (!response) return false;
  const data = await response.json();
  return Array.isArray(data) && data.length > 0;
}

async function savePost(article) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const normalized = normalizeUrl(article.url);
  await supabaseRequest("telegram_posts", {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates"
    },
    body: JSON.stringify({
      source_url: normalized,
      title: article.title,
      image_url: article.image || null
    })
  });
}

async function getAllCandidateArticles() {
  const govArticles = await getGovUzArticles();
  const baholashArticles = await getTelegramChannelArticles("BaholashUz");
  const eduuzArticles = await getTelegramChannelArticles("eduuz");

  const combined = [...govArticles, ...baholashArticles, ...eduuzArticles];

  const uniqueMap = new Map();
  for (const art of combined) {
    const norm = normalizeUrl(art.url);
    if (!uniqueMap.has(norm)) {
      uniqueMap.set(norm, art);
    }
  }

  return [...uniqueMap.values()];
}

async function chooseNews(articles, groqClient) {
  if (!articles || articles.length === 0) return null;
  if (articles.length === 1) return articles[0];

  const data = articles.map((article, index) => ({
    index,
    source: article.source,
    title: article.title,
    date: article.date,
    url: article.url,
    snippet: article.text.slice(0, 300)
  }));

  try {
    const completion = await groqClient.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Sen ALKHARAZMIY Telegram kanalining rasmiy yangilik tanlovchisisan.
Quyida rasmiy manbalardan olingan so'nggi yangiliklar ro'yxati berilgan.
BITTA eng muhim va foydali milliy sertifikat / ta'lim yangiligini tanla.

Ustuvorlik tartibi:
1. Milliy sertifikat imtihonlari va ro'yxatdan o'tish sanalari / ruxsatnomalar
2. Rasmiy e'lonlar va o'zgarishlar
3. Abituriyentlar va o'quvchilar uchun muhim ta'limiy xabarlar

Faqat va faqat quyidagi JSON formatida javob ber:
{"index": 0}
Boshqa hech qanday izoh va matn yozma.`
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
    const cleanJson = rawContent.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleanJson);

    if (Number.isInteger(result.index) && articles[result.index]) {
      return articles[result.index];
    }
  } catch (error) {
    console.error("AI SELECT ERROR:", error.message);
  }

  return articles[0];
}

async function generatePost(article, groqClient) {
  const randomStyle = POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)];

  const completion = await groqClient.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `Sen ALKHARAZMIY Telegram kanalining tajribali AI kontent menejerisan.

ALKHARAZMIY platformasi URL: ${ALKHARAZMIY_URL}
ALKHARAZMIY — matematika va barcha Milliy Sertifikat fanlari bo'yicha tayyorgarlik platformasi hamda onlayn mock testlar tizimi.

QAT'IY QOIDALAR:
1. FAQT VA FAQAT taqdim etilgan rasmiy manbadagi aniq faktlardan foydalan.
2. SANA, RAQAM, NARX, BAL, FAN yoki HUDUDLARNI HECH QACHON o'ylab topma yoki o'zgartirma!
3. Agar taqdim etilgan maqolada yetarli aniq faktlar bo'lmasa yoki xabar noaniq bo'lsa, FAQAT "NO_POST" so'zini qaytar.
4. O'zbek tilida ravon, tushunarli va qiziqarli yoz.
5. Post uslubi / formati: ${randomStyle}.
6. ALKHARAZMIY platformasiga (${ALKHARAZMIY_URL}) tabiiy ravishda qiziqtiruvchi da'vat (CTA) qo'sh (masalan: sertifikat imtihoniga tayyorgarlik va sinov testlari uchun).
7. Telegram HTML formatidan foydalan (<b>bold</b>, <i>italic</i>, <a href="...">link</a>).
8. Hech qachon raw markdown (**bold**, ## header) ishlatma.
9. Post hajmiga e'tibor ber: ixcham va o'qishga qulay bo'lsin.`
      },
      {
        role: "user",
        content: `MANBA: ${article.source} (${article.url})
SARLAVHA: ${article.title}
SANA: ${article.date || "Noma'lum"}
MAQOLA MATNI: ${article.text}

Ushbu rasmiy manba asosida Telegram kanali uchun sifatli Uzbek post yarat. Agar ma'lumot yetarli bo'lmasa, NO_POST deb javob ber.`
      }
    ],
    temperature: 0.5,
    max_tokens: 700
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

export function truncateCaption(caption, maxLen = 1024) {
  if (!caption || caption.length <= maxLen) return caption;
  const truncated = caption.slice(0, maxLen - 4);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen - 120) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

async function sendTelegram(postText, imageUrl) {
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

  if (!TELEGRAM_TOKEN || !CHANNEL_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID must be configured in environment variables.");
  }

  const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  if (imageUrl) {
    try {
      const caption = truncateCaption(postText, 1024);
      const response = await fetch(`${base}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: imageUrl,
          caption,
          parse_mode: "HTML"
        })
      });

      const result = await response.json();
      if (result.ok) {
        return { success: true, method: "sendPhoto", result };
      }
      console.warn("Telegram sendPhoto failed, falling back to sendMessage:", result.description);
    } catch (error) {
      console.warn("Telegram sendPhoto network error, falling back to sendMessage:", error.message);
    }
  }

  const response = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text: postText,
      parse_mode: "HTML",
      disable_web_page_preview: false
    })
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.description || "Telegram sendMessage error");
  }

  return { success: true, method: "sendMessage", result };
}

export default async function handler(req, res) {
  try {
    console.log("ALKHARAZMIY CRON TRIGGERED:", new Date().toISOString());

    const CRON_SECRET = process.env.CRON_SECRET;

    // Security check: Check CRON_SECRET if configured
    if (CRON_SECRET) {
      const authHeader = req.headers?.authorization || "";
      const querySecret = req.query?.secret || "";
      const expectedToken = `Bearer ${CRON_SECRET}`;

      if (authHeader !== expectedToken && querySecret !== CRON_SECRET) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized: Invalid or missing CRON_SECRET."
        });
      }
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "GROQ_API_KEY environment variable is not configured."
      });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Step 1: Collect news articles from multiple official sources
    const candidateArticles = await getAllCandidateArticles();
    console.log("TOTAL CANDIDATE UNPOSTED ARTICLES:", candidateArticles.length);

    if (!candidateArticles.length) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "No new verified official news found."
      });
    }

    // Step 2: Choose the best article using Groq AI
    const selectedArticle = await chooseNews(candidateArticles, groq);
    if (!selectedArticle) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "No suitable article selected."
      });
    }

    // Step 3: Generate post using Groq AI with fact-checking prompt
    const postContent = await generatePost(selectedArticle, groq);

    if (!postContent || postContent.toUpperCase().includes("NO_POST")) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "Sufficiently verified official facts were not available to create a post."
      });
    }

    // Step 4: Send post to Telegram channel
    const sendResult = await sendTelegram(postContent, selectedArticle.image);

    // Step 5: Save post to Supabase ONLY after successful Telegram delivery
    await savePost(selectedArticle);

    return res.status(200).json({
      success: true,
      published: true,
      source: selectedArticle.url,
      source_name: selectedArticle.source,
      title: selectedArticle.title,
      date: selectedArticle.date,
      image: selectedArticle.image,
      telegram_method: sendResult.method,
      post: postContent
    });
  } catch (error) {
    console.error("CRON HANDLER ERROR:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
