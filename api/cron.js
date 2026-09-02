import Groq from "groq-sdk";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

/*
  MUHIM (2026 tuzatish):

  gov.uz portali Next.js ustida ishlaydi va UZBMB
  yangiliklar ro'yxati (bosh sahifadagi "so'nggi
  yangiliklar" bloki ham, /news/news qidiruv sahifasi
  ham) brauzerda JavaScript ishga tushgandan KEYIN,
  mijoz tomonida (client-side) API orqali yuklanadi.

  Ya'ni oddiy `fetch()` bilan olingan HTML ichida
  ko'pincha "/news/view/{id}" havolalari umuman
  bo'lmaydi -> shuning uchun eski kod tez-tez
  "Yangi rasmiy yangilik topilmadi" deb qaytargan,
  garchi saytda haqiqatda yangiliklar mavjud bo'lsa ham.

  YECHIM: birinchi navbatda haqiqiy (headless) brauzer
  orqali sahifani to'liq render qilib, DOM'dan havolalarni
  o'qiymiz (GOV_PAGES). Agar biror sababga ko'ra brauzer
  ishga tushmasa (masalan resurs cheklovi), avvalgi statik
  HTML+regex usuli FALLBACK sifatida ishlaydi, shunda ham
  cron butunlay ishlamay qolmaydi.
*/

const GOV_PAGES = [
  "https://gov.uz/oz/uzbmb",
  "https://gov.uz/oz/uzbmb/news/news"
];

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
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

/*
  HTML (yoki JSON ichiga escape qilingan HTML) matnidan
  "/news/view/{id}" ko'rinishidagi barcha ID larni topadi.
  Bir nechta encoding variantini qamrab oladi, chunki
  Next.js ba'zan havolani JSON ichida "news\/view\/123"
  yoki "news%2Fview%2F123" ko'rinishida yashiradi.
*/
function extractNewsIds(html) {
  const ids = new Set();

  const patterns = [
    /\/news\/view\/(\d+)/gi,
    /news\\\/view\\\/(\d+)/gi,
    /news%2Fview%2F(\d+)/gi
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      ids.add(match[1]);
    }
  }

  return [...ids];
}

/*
  1-QATLAM: Headless brauzer orqali (asosiy usul).

  Sahifani chinakam brauzerda ochamiz, JS ishga tushib,
  yangiliklar ro'yxati DOM'ga chizilishini kutamiz, so'ng
  barcha "/news/view/{id}" havolalarini DOM'dan o'qiymiz.
*/
async function getNewsIdsViaBrowser() {
  let browser;
  const allIds = new Set();

  try {
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
    );

    for (const url of GOV_PAGES) {
      try {
        await page.goto(url, {
          waitUntil: "networkidle2",
          timeout: 25000
        });

        // Yangiliklar ro'yxati JS orqali chizilishi uchun biroz kutamiz.
        await page
          .waitForSelector('a[href*="/news/view/"]', { timeout: 8000 })
          .catch(() => {
            console.log("BROWSER: /news/view/ havolasi topilmadi ->", url);
          });

        const hrefs = await page.$$eval(
          'a[href*="/news/view/"]',
          (els) => els.map((el) => el.getAttribute("href") || "")
        );

        for (const href of hrefs) {
          const match = href.match(/\/news\/view\/(\d+)/);

          if (match) {
            allIds.add(match[1]);
          }
        }

        // Ehtiyot uchun: to'liq render qilingan HTML ichidan ham qidiramiz
        // (masalan, havola alohida <a> emas, boshqa elementda bo'lsa).
        const renderedHtml = await page.content();

        for (const id of extractNewsIds(renderedHtml)) {
          allIds.add(id);
        }

        console.log(
          "BROWSER OK:",
          url,
          "-> topilgan ID lar:",
          [...allIds].length
        );
      } catch (pageError) {
        console.error("BROWSER PAGE ERROR:", url, pageError.message);
      }
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return [...allIds];
}

/*
  2-QATLAM: Statik HTML + regex (FALLBACK).

  Faqat headless brauzer usuli 0 ta natija bergan yoki
  xato bergan holatda ishga tushadi.
*/
async function getNewsIdsViaStaticHtml() {
  const allIds = new Set();

  for (const url of GOV_PAGES) {
    try {
      const html = await fetchPage(url);
      const ids = extractNewsIds(html);

      console.log("STATIC FALLBACK:", url, "-> topilgan ID lar:", ids.length);

      for (const id of ids) {
        allIds.add(id);
      }
    } catch (error) {
      console.error("STATIC FALLBACK ERROR:", url, error.message);
    }
  }

  return [...allIds];
}

/*
  Rasmiy UZBMB sahifasidan yangiliklar havolalarini yig'adi.
  Avval brauzer usuli, natija bo'lmasa - statik fallback.
*/
async function getNewsLinks() {
  let ids = [];

  try {
    ids = await getNewsIdsViaBrowser();
  } catch (error) {
    console.error("BROWSER LAYER FAILED:", error.message);
  }

  if (!ids.length) {
    console.log(
      "Brauzer orqali hech narsa topilmadi (yoki brauzer ishga tushmadi) - statik fallback ishga tushmoqda."
    );

    ids = await getNewsIdsViaStaticHtml();
  }

  console.log("JAMI TOPILGAN NEWS ID LAR:", ids.length, ids);

  return ids.map((id) => `https://gov.uz/oz/uzbmb/news/view/${id}`);
}

/*
  Maqolani o'qish. Bu sahifalar (individual /news/view/{id})
  gov.uz'da server tomonida to'liq render qilingani
  tasdiqlangan, shuning uchun oddiy fetch() bilan ishonchli
  o'qiladi - bu yerda brauzer shart emas.
*/
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
      title = cleanText(match[1]);

      if (title) {
        break;
      }
    }
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
        image = new URL(match[1], url).href;
        break;
      } catch {
        image = null;
      }
    }
  }

  /*
    Sana: eski kodda yil raqami (2026) qattiq yozilgan edi -
    shu sabab boshqa yildagi maqolalar sanasi o'qilmasdi.
    Endi yilga bog'liq bo'lmagan umumiy patternlar ishlatiladi.
  */
  let date = null;

  const datePatterns = [
    /datetime=["']([^"']+)["']/i,
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}\.\d{2}\.\d{4})/,
    /(\d{2}-\d{2}-\d{4})/
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

/*
  SUPABASE so'rov (bir marta qayta urinish bilan).
*/
async function supabaseRequest(endpoint, options = {}, retry = true) {
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

/*
  Yangilik avval yuborilganmi?
*/
async function isPosted(url) {
  const encoded = encodeURIComponent(url);

  const response = await supabaseRequest(
    `telegram_posts?source_url=eq.${encoded}&select=id`
  );

  const data = await response.json();

  return data.length > 0;
}

/*
  Supabase'ga saqlash.
*/
async function savePost(article) {
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

/*
  Rasmiy maqolalarni yig'ish.
*/
async function getArticles() {
  const links = await getNewsLinks();

  console.log("TOTAL NEWS LINKS:", links.length);

  const articles = [];

  for (const link of links.slice(0, 15)) {
    try {
      if (await isPosted(link)) {
        console.log("Already posted:", link);
        continue;
      }

      const article = await getArticle(link);

      if (article.title && article.text) {
        articles.push(article);
        console.log("NEW:", article.title);
      } else {
        console.log("SKIP (title/text yo'q):", link);
      }
    } catch (error) {
      console.error("ARTICLE ERROR:", link, error.message);
    }
  }

  return articles;
}

/*
  AI yangilik tanlaydi.
*/
async function chooseNews(articles) {
  const data = articles.map((article, index) => ({
    index,
    title: article.title,
    date: article.date,
    url: article.url
  }));

  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",

    messages: [
      {
        role: "system",

        content: `
Sen ALKHARAZMIY Telegram kanalining
yangilik tanlovchisisan.

Barcha maqolalar rasmiy
Bilim va malakalarni baholash
agentligi manbasidan olingan.

BITTA eng foydali yangilikni tanla.

Ustuvorlik:

1. Milliy Sertifikat bilan bog'liq yangiliklar
2. Imtihon sanasi
3. Ro'yxatdan o'tish
4. Ruxsatnoma
5. Natijalar
6. Eng yangi
7. Muhim rasmiy o'zgarish

Eslatma: ALKHARAZMIY faqat matematika emas,
barcha Milliy Sertifikat fanlari bo'yicha
tayyorgarlik platformasi. Shuni yodda tut.

Faqat JSON qaytar:

{"index":0}

Boshqa hech narsa yozma.
`
      },
      {
        role: "user",
        content: JSON.stringify(data)
      }
    ],

    temperature: 0.1,
    max_tokens: 50
  });

  try {
    const result = JSON.parse(
      completion.choices[0].message.content.trim()
    );

    if (Number.isInteger(result.index) && articles[result.index]) {
      return articles[result.index];
    }
  } catch (error) {
    console.error("AI SELECT ERROR:", error.message);
  }

  return articles[0];
}

/*
  Telegram posti yaratish.
*/
async function generatePost(article) {
  const completion = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b",

    messages: [
      {
        role: "system",

        content: `
Sen ALKHARAZMIY Telegram kanalining
AI kontent menejerisan.

ALKHARAZMIY:
${ALKHARAZMIY_URL}

ALKHARAZMIY — turli fanlar bo'yicha
Milliy Sertifikat imtihonlariga
tayyorlanish platformasi.

Bu faqat matematika platformasi emas.

POST QOIDALARI:

- Faqat rasmiy maqoladagi faktlardan foydalan.
- Fakt o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- Hamma ma'lumotni birdaniga berma.
- Qiziqish uyg'ot.
- O'quvchiga foydali asosiy ma'lumotni ber.
- Juda uzun yozma.
- O'zbek tilida yoz.
- Tabiiy Telegram uslubida yoz.
- Emoji me'yorida ishlat.
- Clickbait ishlatma.
- Har safar bir xil boshlama.
- Har postda boshqa jihatni yoritishga harakat qil.
- ALKHARAZMIY saytiga tabiiy ravishda qiziqtir.

Sayt:
${ALKHARAZMIY_URL}

FAQAT POST MATNINI QAYTAR.
`
      },
      {
        role: "user",

        content: `
RASMIY MANBA:
${article.url}

SANA:
${article.date}

SARLAVHA:
${article.title}

MAQOLA:
${article.text}

Shu rasmiy maqola asosida
ALKHARAZMIY Telegram kanali uchun
bitta qiziqarli post yoz.
`
      }
    ],

    temperature: 0.75,
    max_tokens: 700
  });

  return completion.choices[0].message.content.trim();
}

/*
  Telegramga rasm bilan yuborish (rasm ishlamasa - matn).
*/
async function sendTelegram(post, image) {
  const base = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  if (image) {
    try {
      const response = await fetch(`${base}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: image,
          caption: post
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

  // Rasm ishlamasa (yoki rasm umuman bo'lmasa), matnni baribir yuboramiz.
  const response = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text: post,
      disable_web_page_preview: false
    })
  });

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description || "Telegram error");
  }

  return result;
}

/*
  MAIN
*/
export default async function handler(req, res) {
  try {
    /*
      CRON SECURITY
    */
    const auth = req.headers.authorization;

    if (
      process.env.CRON_SECRET &&
      auth !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      console.error("CRON: Unauthorized so'rov.");

      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    console.log("ALKHARAZMIY CRON STARTED", new Date().toISOString());

    /*
      1. Yangiliklarni olish
    */
    const articles = await getArticles();

    /*
      2. Yangi yangilik yo'q
    */
    if (!articles.length) {
      console.log(
        "CRON RESULT: yangi yangilik topilmadi (barchasi allaqachon yuborilgan yoki manbada yangilik yo'q)."
      );

      return res.status(200).json({
        success: true,
        message: "Yangi rasmiy yangilik topilmadi. Post yuborilmadi.",
        checked: true
      });
    }

    /*
      3. Eng yaxshi yangilik
    */
    const selected = await chooseNews(articles);

    /*
      4. Post
    */
    const post = await generatePost(selected);

    /*
      5. Telegram
    */
    await sendTelegram(post, selected.image);

    /*
      6. Supabase
    */
    await savePost(selected);

    console.log("CRON RESULT: post muvaffaqiyatli yuborildi:", selected.url);

    return res.status(200).json({
      success: true,
      message: "Rasmiy yangilik Telegramga yuborildi!",
      source: selected.url,
      title: selected.title,
      date: selected.date,
      image: selected.image,
      post
    });
  } catch (error) {
    console.error("CRON ERROR:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
      type: error.name
    });
  }
  }
