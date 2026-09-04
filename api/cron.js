import Groq from "groq-sdk";

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
  "education Uzbekistan",
  "Bilim va malakalarni baholash agentligi",
  "DTM O'zbekiston",
  "DTM test",
  "ta'lim yangiliklari O'zbekiston",
  "abituriyent yangiliklari",
  "OTMga kirish",
  "OTM qabul",
  "kirish imtihonlari O'zbekiston",
  "maktab ta'limi O'zbekiston",
  "fan olimpiadalari O'zbekiston",
  "matematika sertifikat",
  "tarix sertifikat",
  "ona tili sertifikat",
  "fizika sertifikat",
  "biologiya sertifikat",
  "kimyo sertifikat",
  "chet tili CEFR",
  "IELTS O'zbekiston",
  "National Certificate Uzbekistan",
  "education Uzbekistan news"
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

export function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function cleanText(html) {
  if (!html) return "";
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeHtmlEntities(cleaned);
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const urlObj = new URL(rawUrl);
    urlObj.hash = "";
    const keysToKeep = [];
    for (const [key, value] of [...urlObj.searchParams.entries()]) {
      if (!key.startsWith("utm_") && !key.startsWith("fbclid") && key !== "oc") {
        keysToKeep.push([key, value]);
      }
    }
    urlObj.search = "";
    for (const [k, v] of keysToKeep) {
      urlObj.searchParams.append(k, v);
    }
    let str = urlObj.toString();
    if (str.endsWith("/")) str = str.slice(0, -1);
    return str;
  } catch {
    return rawUrl.trim();
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves Google News redirect URL to original source URL using batchexecute API.
 */
export async function resolveGoogleNewsUrl(googleNewsUrl) {
  try {
    const match = googleNewsUrl.match(/articles\/([^?]+)/);
    if (!match) return googleNewsUrl;
    const base64Str = match[1];

    let pageRes = await fetchWithTimeout(`https://news.google.com/articles/${base64Str}`, {}, 7000);
    if (!pageRes.ok) {
      pageRes = await fetchWithTimeout(`https://news.google.com/rss/articles/${base64Str}`, {}, 7000);
    }

    if (!pageRes.ok) return null;

    const html = await pageRes.text();
    const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
    const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);

    if (!sgMatch || !tsMatch) return null;

    const signature = sgMatch[1];
    const timestamp = tsMatch[1];

    const payload = [
      "Fbv4je",
      `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`
    ];

    const batchRes = await fetchWithTimeout(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`
      },
      7000
    );

    if (!batchRes.ok) return null;

    const batchText = await batchRes.text();
    const parsedData = JSON.parse(batchText.split("\n\n")[1]).slice(0, -2);
    const decodedUrl = JSON.parse(parsedData[0][2])[1];
    return decodedUrl;
  } catch (err) {
    console.warn("Google News URL resolution failed for:", googleNewsUrl, err.message);
    return null;
  }
}

function isGoogleOrInvalidImage(imgUrl) {
  if (!imgUrl) return true;
  const lower = imgUrl.toLowerCase();
  if (
    lower.includes("google") ||
    lower.includes("gstatic") ||
    lower.includes("googleusercontent") ||
    lower.includes("favicon") ||
    lower.includes("logo") ||
    lower.includes("avatar") ||
    lower.includes("icon") ||
    lower.endsWith(".svg")
  ) {
    return true;
  }
  return false;
}

/**
 * Scrapes original article HTML page to extract canonical URL, title, date, main text, and original image.
 */
export async function scrapeOriginalArticle(pageUrl, fallbackDate = null) {
  try {
    const res = await fetchWithTimeout(pageUrl, {}, 10000);
    if (!res.ok) return null;

    const html = await res.text();

    // 1. Canonical URL
    let canonicalUrl = normalizeUrl(pageUrl);
    const canonicalMatch =
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ||
      html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    if (canonicalMatch && canonicalMatch[1]) {
      try {
        const resolved = new URL(canonicalMatch[1], pageUrl).href;
        canonicalUrl = normalizeUrl(resolved);
      } catch {}
    }

    // 2. Title
    let title = null;
    const titlePatterns = [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
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

    // 3. Image
    let image = null;

    const imagePatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
    ];

    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        try {
          const rawImg = decodeHtmlEntities(match[1].trim());
          const absImg = new URL(rawImg, pageUrl).href;
          if (!isGoogleOrInvalidImage(absImg)) {
            image = absImg;
            break;
          }
        } catch {}
      }
    }

    if (!image) {
      const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const m of jsonLdMatches) {
        try {
          const jsonLd = JSON.parse(m[1].trim());
          const extractImgFromJson = (obj) => {
            if (!obj) return null;
            if (typeof obj === "string" && !isGoogleOrInvalidImage(obj)) return obj;
            if (Array.isArray(obj)) {
              for (const item of obj) {
                const found = extractImgFromJson(item);
                if (found) return found;
              }
            } else if (typeof obj === "object") {
              if (obj.url && typeof obj.url === "string" && !isGoogleOrInvalidImage(obj.url)) return obj.url;
              if (obj.image) return extractImgFromJson(obj.image);
            }
            return null;
          };
          const ldImg = extractImgFromJson(jsonLd);
          if (ldImg) {
            image = new URL(ldImg, pageUrl).href;
            break;
          }
        } catch {}
      }
    }

    // 4. Date
    let date = fallbackDate;
    const datePatterns = [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
      /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
      /"datePublished"\s*:\s*"([^"]+)"/i,
      /datetime=["']([^"']+)["']/i,
      /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i,
      /(\d{4}-\d{2}-\d{2})/
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        date = match[1];
        break;
      }
    }

    // 5. Main text
    const text = cleanText(html);
    if (!text || text.length < 50) return null;

    let sourceDomain = "";
    try {
      sourceDomain = new URL(canonicalUrl).hostname.replace(/^www\./, "");
    } catch {
      sourceDomain = pageUrl;
    }

    return {
      url: canonicalUrl,
      raw_url: pageUrl,
      source: sourceDomain,
      title,
      date,
      image,
      text: text.slice(0, 15000)
    };
  } catch (err) {
    console.warn("Error scraping original article:", pageUrl, err.message);
    return null;
  }
}

/**
 * Fetches Google News RSS items for a topic.
 */
async function fetchGoogleNewsRss(topic) {
  const items = [];
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=uz&gl=UZ&ceid=UZ:uz`;
    const response = await fetchWithTimeout(rssUrl, {}, 8000);
    if (!response.ok) return items;

    const xml = await response.text();
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const m of itemMatches) {
      const itemXml = m[1];
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      if (titleMatch && linkMatch) {
        const rawTitle = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const googleLink = linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        const pubDateStr = pubDateMatch ? pubDateMatch[1].trim() : null;

        items.push({
          rawTitle: decodeHtmlEntities(rawTitle),
          googleLink,
          pubDateStr,
          topic
        });
      }
    }
  } catch (err) {
    console.warn(`Error fetching RSS for topic "${topic}":`, err.message);
  }
  return items;
}

/**
 * Scraping supplementary Telegram Channels (e.g. @BaholashUz, @eduuz)
 */
async function getTelegramChannelArticles(channelUsername) {
  const webUrl = `https://t.me/s/${channelUsername}`;
  const articles = [];

  try {
    const res = await fetchWithTimeout(webUrl, {}, 8000);
    if (!res.ok) return articles;

    const html = await res.text();
    const messages = html.split('<div class="tgme_widget_message ');

    for (let i = messages.length - 1; i >= 1; i--) {
      if (articles.length >= 5) break;

      const msgBlock = messages[i];
      const linkMatch = msgBlock.match(/href="(https:\/\/t\.me\/[^\/]+\/\d+)"/);
      if (!linkMatch) continue;

      const postUrl = normalizeUrl(linkMatch[1]);

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
    console.warn(`TELEGRAM SCRAPE ERROR (@${channelUsername}):`, error.message);
  }

  return articles;
}

/**
 * Supabase helper
 */
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
      console.warn("SUPABASE RETRY:", endpoint, error.message);
      return supabaseRequest(endpoint, options, false);
    }
    throw error;
  }
}

export async function isPosted(url) {
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

export async function savePost(article) {
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

/**
 * Helper to check date age in days (allow up to 7 days max).
 */
function isFreshArticle(dateStr, maxDays = 7) {
  if (!dateStr) return true;
  try {
    const pubTime = new Date(dateStr).getTime();
    if (isNaN(pubTime)) return true;
    const now = Date.now();
    const diffDays = (now - pubTime) / (1000 * 60 * 60 * 24);
    return diffDays <= maxDays && diffDays >= -1;
  } catch {
    return true;
  }
}

/**
 * Filter out unrelated topics (e.g. motorsport DTM, WWE wrestling, travel deals)
 */
function isEducationalArticle(title, text) {
  const combined = `${title} ${text.slice(0, 500)}`.toLowerCase();
  const educationalKeywords = [
    "sertifikat", "sertifikasiya", "imtihon", "test", "uzbmb", "dtm", "ta'lim", "talim",
    "abituriyent", "otm", "oliy", "maktab", "olimpiada", "maktab", "vazirlik", "cefr",
    "ielts", "pedagog", "o'qituvchi", "oquvchi", "talaba", "kurs", "grant", "baholash",
    "matematika", "tarix", "fizika", "biologiya", "kimyo", "til", "fan", "ruxsatnoma",
    "natija", "ball", "kvota", "qabul", "o'zbekiston", "uzbekistan", "education"
  ];
  return educationalKeywords.some(kw => combined.includes(kw));
}

/**
 * Collect internet news from Google News RSS across multiple topics + Telegram channels.
 */
export async function getAllCandidateArticles() {
  const candidateMap = new Map();
  const processedUrls = new Set();

  for (const topic of SEARCH_TOPICS) {
    if (candidateMap.size >= 12) break;

    const rssItems = await fetchGoogleNewsRss(topic);

    for (const item of rssItems) {
      if (candidateMap.size >= 12) break;

      if (!isFreshArticle(item.pubDateStr, 7)) continue;

      const decodedUrl = await resolveGoogleNewsUrl(item.googleLink);
      if (!decodedUrl) continue;

      const normUrl = normalizeUrl(decodedUrl);
      if (processedUrls.has(normUrl)) continue;
      processedUrls.add(normUrl);

      if (await isPosted(normUrl)) {
        console.log("Already posted article in Supabase:", normUrl);
        continue;
      }

      const article = await scrapeOriginalArticle(decodedUrl, item.pubDateStr);
      if (
        article &&
        article.title &&
        article.text &&
        article.text.length > 50 &&
        isEducationalArticle(article.title, article.text)
      ) {
        const normCanonical = normalizeUrl(article.url);
        if (await isPosted(normCanonical)) {
          console.log("Already posted canonical article in Supabase:", normCanonical);
          continue;
        }

        candidateMap.set(normCanonical, article);
        console.log(`FOUND CANDIDATE [${topic}]:`, article.title, `(${article.source})`);
      }
    }
  }

  if (candidateMap.size < 5) {
    const baholashArticles = await getTelegramChannelArticles("BaholashUz");
    const eduuzArticles = await getTelegramChannelArticles("eduuz");

    for (const art of [...baholashArticles, ...eduuzArticles]) {
      const norm = normalizeUrl(art.url);
      if (!candidateMap.has(norm) && !(await isPosted(norm))) {
        candidateMap.set(norm, art);
      }
    }
  }

  return [...candidateMap.values()];
}

/**
 * Select the single best article using Groq AI
 */
export async function chooseNews(articles, groqClient) {
  if (!articles || articles.length === 0) return null;
  if (articles.length === 1) return articles[0];

  const data = articles.map((article, index) => ({
    index,
    source: article.source,
    title: article.title,
    date: article.date,
    url: article.url,
    hasImage: Boolean(article.image),
    isOfficialGovUz: article.url.includes("gov.uz"),
    snippet: article.text.slice(0, 300)
  }));

  try {
    const completion = await groqClient.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Sen ALKHARAZMIY Telegram kanalining rasmiy yangilik tanlovchisisan.
Quyida internet va rasmiy manbalardan topilgan so'nggi ta'limiy va milliy sertifikat yangiliklari berilgan.
BITTA eng muhim, dolzarb va foydali yangilikni tanla.

Ustuvorlik mezonlari:
1. Milliy sertifikat imtihonlari, ro'yxatdan o'tish sanalari va natijalar
2. Rasmiy ta'limiy e'lonlar va o'zgarishlar (UZBMB, DTM, OTM, maktab va olimpiada xabarlari)
3. Abituriyentlar va o'quvchilar uchun eng amaliy va muhim yangiliklar
4. Yangilikning sarmasi, ishonchliligi va foydaliligi

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
    console.warn("AI SELECT ERROR:", error.message);
  }

  return articles[0];
}

/**
 * Generate a short, natural Uzbek Telegram post using Groq AI
 */
export async function generatePost(article, groqClient) {
  const randomStyle = POST_STYLES[Math.floor(Math.random() * POST_STYLES.length)];

  const completion = await groqClient.chat.completions.create({
    model: "openai/gpt-oss-20b",
    messages: [
      {
        role: "system",
        content: `Sen ALKHARAZMIY Telegram kanalining tajribali AI kontent menejerisan.

ALKHARAZMIY platformasi URL: ${ALKHARAZMIY_URL}
ALKHARAZMIY — matematika, barcha fanlar bo'yicha Milliy Sertifikat imtihonlariga tayyorgarlik platformasi hamda onlayn mock testlar tizimi.

QAT'IY QOIDALAR:
1. FAQT VA FAQAT taqdim etilgan maqoladagi aniq faktlardan foydalan.
2. SANA, RAQAM, NARX, BAL, FAN yoki HUDUDLARNI HECH QACHON o'ylab topma va gallyutsinatsiya qilma!
3. Agar taqdim etilgan maqolada yetarli aniq ta'limiy faktlar bo'lmasa, FAQAT "NO_POST" so'zini qaytar.
4. Post uslubi / formati: ${randomStyle}.
5. Matnni nusxalamagin, o'quvchida qiziqish va intilish uyg'otadigan qisqa, jonli va ravon o'zbek tilida yoz.
6. O'quvchilar va abituriyentlar uchun nima uchun muhimligini tushuntir.
7. ALKHARAZMIY platformasiga (${ALKHARAZMIY_URL}) tabiiy ravishda qiziqtiruvchi da'vat (CTA) qo'sh (masalan: sertifikat imtihoniga tayyorgarlik va sinov testlari uchun).
8. Asl manba havolasini ushbu formatda kiriting: <a href="${article.url}">Manba: ${article.source}</a>
9. Telegram HTML formatidan foydalan (<b>bold</b>, <i>italic</i>, <a href="...">link</a>). RAW markdown (**bold**, ## header) ishlatma.
10. Caption hajmiga mos, ixcham yoz.`
      },
      {
        role: "user",
        content: `MANBA: ${article.source} (${article.url})
SARLAVHA: ${article.title}
SANA: ${article.date || "Noma'lum"}
MAQOLA MATNI: ${article.text}

Ushbu manba asosida Telegram kanali uchun sifatli Uzbek post yarat. Agar ma'lumot yetarli bo'lmasa, NO_POST deb javob ber.`
      }
    ],
    temperature: 0.5,
    max_tokens: 700
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

export function truncateCaption(caption, maxLen = 1024) {
  if (!caption || caption.length <= maxLen) return caption;
  const plain = caption.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= maxLen) return plain;

  const truncated = plain.slice(0, maxLen - 4);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLen - 120) {
    return truncated.slice(0, lastSpace) + "...";
  }
  return truncated + "...";
}

export async function sendTelegram(postText, imageUrl) {
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

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "GROQ_API_KEY environment variable is not configured."
      });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    // Step 1: Collect internet news articles across multiple educational search queries
    const candidateArticles = await getAllCandidateArticles();
    console.log("TOTAL CANDIDATE UNPOSTED ARTICLES:", candidateArticles.length);

    if (!candidateArticles.length) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "Yangi rasmiy yoki ishonchli manbalardan ta'limiy yangilik topilmadi."
      });
    }

    // Step 2: Select best article using Groq AI
    const selectedArticle = await chooseNews(candidateArticles, groq);
    if (!selectedArticle) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "Munosib yangilik tanlanmadi."
      });
    }

    // Step 3: Generate Uzbek post content using Groq AI
    const postContent = await generatePost(selectedArticle, groq);

    if (!postContent || postContent.toUpperCase().includes("NO_POST")) {
      return res.status(200).json({
        success: true,
        published: false,
        reason: "Yetarlicha aniq faktlar mavjud bo'lmagani sababli post yaratilmadi."
      });
    }

    // Step 4: Send post to Telegram channel
    const sendResult = await sendTelegram(postContent, selectedArticle.image);

    // Step 5: Save post to Supabase only after successful Telegram delivery
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
