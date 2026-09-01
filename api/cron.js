import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const ALKHARAZMIY_URL = "https://alkharazmiy.xyz";

const SOURCES = [
  "https://gov.uz/oz/uzbmb",
  "https://gov.uz/oz/uzbmb/news"
];

const MAX_ARTICLES_TO_CHECK = 50;

/* =========================================================
   VALIDATE ENV
========================================================= */

function validateEnv() {
  const required = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN: TELEGRAM_TOKEN,
    TELEGRAM_CHANNEL_ID: CHANNEL_ID
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}`
    );
  }
}

/* =========================================================
   HTML TO TEXT
========================================================= */

function cleanText(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return " ";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   FETCH
========================================================= */

async function fetchPage(url) {
  console.log("FETCH:", url);

  const response = await fetch(url, {
    method: "GET",

    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",

      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

      "Accept-Language":
        "uz-UZ,uz;q=0.9,ru;q=0.8,en;q=0.7",

      "Cache-Control":
        "no-cache"
    },

    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return await response.text();
}

/* =========================================================
   NORMALIZE URL
========================================================= */

function normalizeGovUrl(value) {
  if (!value) {
    return null;
  }

  let url = value
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .trim();

  try {
    const parsed = new URL(
      url,
      "https://gov.uz"
    );

    parsed.hash = "";

    /*
      Faqat gov.uz URL'lari
    */
    if (
      parsed.hostname !== "gov.uz" &&
      !parsed.hostname.endsWith(".gov.uz")
    ) {
      return null;
    }

    /*
      Faqat UZBMB news
    */
    if (
      !/^\/(?:oz|uz|en)\/uzbmb\/news\/view\/\d+\/?$/i.test(
        parsed.pathname
      )
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

/* =========================================================
   EXTRACT NEWS LINKS
========================================================= */

function extractNewsLinks(html) {
  const links = new Set();

  /*
    1. href ichidan qidirish
  */

  const hrefRegex =
    /href\s*=\s*["']([^"']+)["']/gi;

  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const url = normalizeGovUrl(
      match[1]
    );

    if (url) {
      links.add(url);
    }
  }

  /*
    2. HTML ichidagi barcha URL'larni qidirish
  */

  const urlRegex =
    /(?:https?:\/\/gov\.uz)?\/(?:oz|uz|en)\/uzbmb\/news\/view\/\d+\/?/gi;

  while ((match = urlRegex.exec(html)) !== null) {
    const url = normalizeGovUrl(
      match[0]
    );

    if (url) {
      links.add(url);
    }
  }

  /*
    3. Escaped URL
  */

  const escapedHtml =
    html.replace(/\\\//g, "/");

  const escapedRegex =
    /(?:https?:\/\/gov\.uz)?\/(?:oz|uz|en)\/uzbmb\/news\/view\/\d+\/?/gi;

  while (
    (match = escapedRegex.exec(escapedHtml)) !== null
  ) {
    const url = normalizeGovUrl(
      match[0]
    );

    if (url) {
      links.add(url);
    }
  }

  return [...links];
}

/* =========================================================
   GET NEWS LINKS
========================================================= */

async function getNewsLinks() {
  const allLinks = new Set();

  /*
    Bir nechta manbani tekshiramiz
  */

  for (const source of SOURCES) {
    try {
      const html =
        await fetchPage(source);

      const links =
        extractNewsLinks(html);

      console.log(
        `FOUND ${links.length} NEWS LINKS FROM: ${source}`
      );

      for (const link of links) {
        allLinks.add(link);
      }

    } catch (error) {
      console.error(
        `SOURCE ERROR ${source}:`,
        error.message
      );
    }
  }

  /*
    Agar yuqoridan hech narsa chiqmasa,
    pagination sahifalarini tekshiramiz.
  */

  if (allLinks.size === 0) {
    console.log(
      "No links found. Checking pagination..."
    );

    const possiblePages = [
      "https://gov.uz/oz/uzbmb/news?page=1",
      "https://gov.uz/oz/uzbmb/news?page=2",
      "https://gov.uz/oz/uzbmb/news?page=3",
      "https://gov.uz/oz/uzbmb/news?page=4",
      "https://gov.uz/oz/uzbmb/news?page=5"
    ];

    for (const page of possiblePages) {
      try {
        const html =
          await fetchPage(page);

        const links =
          extractNewsLinks(html);

        console.log(
          `FOUND ${links.length} LINKS FROM ${page}`
        );

        for (const link of links) {
          allLinks.add(link);
        }

      } catch (error) {
        console.error(
          `PAGINATION ERROR ${page}:`,
          error.message
        );
      }
    }
  }

  const result = [...allLinks];

  console.log(
    "TOTAL UNIQUE NEWS LINKS:",
    result.length
  );

  return result;
}

/* =========================================================
   GET ARTICLE
========================================================= */

async function getNewsArticle(url) {
  const html =
    await fetchPage(url);

  /*
    TITLE
  */

  let title = null;

  const titlePatterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,

    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,

    /<h1[^>]*>([\s\S]*?)<\/h1>/i,

    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of titlePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      title =
        cleanText(match[1]);

      if (title) {
        break;
      }
    }
  }

  /*
    IMAGE
  */

  let image = null;

  const imagePatterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,

    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];

  for (const pattern of imagePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      try {
        image =
          new URL(
            match[1]
              .replace(/&amp;/gi, "&"),
            url
          ).href;

        break;
      } catch {}
    }
  }

  /*
    DATE
  */

  let date = null;

  const datePatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,

    /<time[^>]+datetime=["']([^"']+)["']/i,

    /datetime=["']([^"']+)["']/i,

    /(20\d{2}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?)/i,

    /(20\d{2}-\d{2}-\d{2})/i
  ];

  for (const pattern of datePatterns) {
    const match =
      html.match(pattern);

    if (match?.[1]) {
      date = match[1];
      break;
    }
  }

  /*
    TEXT
  */

  const text =
    cleanText(html);

  return {
    url,
    title,
    date,
    image,
    text: text.slice(0, 20000)
  };
}

/* =========================================================
   SUPABASE REQUEST
========================================================= */

async function supabaseRequest(
  endpoint,
  options = {}
) {
  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${endpoint}`,
      {
        ...options,

        headers: {
          apikey:
            SUPABASE_KEY,

          Authorization:
            `Bearer ${SUPABASE_KEY}`,

          "Content-Type":
            "application/json",

          ...(options.headers || {})
        }
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `Supabase ${response.status}: ${body}`
    );
  }

  return response;
}

/* =========================================================
   CHECK DUPLICATE
========================================================= */

async function isPosted(url) {
  const encoded =
    encodeURIComponent(url);

  const response =
    await supabaseRequest(
      `telegram_posts?source_url=eq.${encoded}&select=id&limit=1`
    );

  const data =
    await response.json();

  return Array.isArray(data) &&
    data.length > 0;
}

/* =========================================================
   SAVE POST
========================================================= */

async function savePost(article) {
  await supabaseRequest(
    "telegram_posts",
    {
      method: "POST",

      headers: {
        Prefer:
          "resolution=ignore-duplicates"
      },

      body: JSON.stringify({
        source_url:
          article.url,

        title:
          article.title,

        image_url:
          article.image
      })
    }
  );

  console.log(
    "SAVED TO SUPABASE:",
    article.url
  );
}

/* =========================================================
   GET NEW ARTICLES
========================================================= */

async function getNewArticles() {
  const links =
    await getNewsLinks();

  if (!links.length) {
    console.log(
      "NO NEWS LINKS FOUND."
    );

    return [];
  }

  const articles = [];

  /*
    50 tagacha tekshiramiz.
    Bu yerda SANA FILTRI YO'Q.
  */

  for (
    const link of links.slice(
      0,
      MAX_ARTICLES_TO_CHECK
    )
  ) {
    try {
      const posted =
        await isPosted(link);

      if (posted) {
        console.log(
          "ALREADY POSTED:",
          link
        );

        continue;
      }

      const article =
        await getNewsArticle(link);

      if (
        !article.title ||
        article.title.length < 5
      ) {
        console.log(
          "SKIP: NO TITLE",
          link
        );

        continue;
      }

      if (
        !article.text ||
        article.text.length < 100
      ) {
        console.log(
          "SKIP: ARTICLE TEXT TOO SHORT",
          link
        );

        continue;
      }

      articles.push(article);

      console.log(
        "NEW ARTICLE:",
        article.title
      );

    } catch (error) {
      console.error(
        "ARTICLE ERROR:",
        link,
        error.message
      );
    }
  }

  console.log(
    "NEW ARTICLES FOUND:",
    articles.length
  );

  return articles;
}

/* =========================================================
   CHOOSE NEWS WITH AI
========================================================= */

async function chooseNews(
  articles
) {
  if (!articles.length) {
    return null;
  }

  const simplified =
    articles.map(
      (article, index) => ({
        index,

        title:
          article.title,

        date:
          article.date,

        url:
          article.url
      })
    );

  const completion =
    await groq.chat.completions.create({
      model:
        "openai/gpt-oss-20b",

      messages: [
        {
          role: "system",

          content: `
Sen ALKHARAZMIY Telegram kanalining
rasmiy yangilik tanlovchisisan.

Barcha maqolalar UZBMBning
rasmiy gov.uz manbasidan olingan.

VAZIFA:

Hali Telegram kanaliga yuborilmagan
maqolalar ichidan ENG FOYDALI BITTA
yangilikni tanla.

MUHIM:

Yangilik aynan bugungi kunniki
bo'lishi SHART EMAS.

2-3 kun oldingi muhim yangilik
yangi, lekin ahamiyatsiz yangilikdan
USTUN bo'lishi mumkin.

Tanlash mezonlari:

1. Milliy sertifikat
2. Imtihon sanasi
3. Imtihon tartibi
4. Ro'yxatdan o'tish
5. Ruxsatnoma
6. Natijalar
7. Abituriyentlar uchun muhim o'zgarish
8. Muhim rasmiy e'lon
9. Chet tili imtihonlari
10. Umumta'lim fanlari imtihonlari

SANA — faqat yordamchi mezon.

Avvalo FOYDALI va MUHIM
yangilikni tanla.

Faqat quyidagi JSON formatida javob ber:

{"index": 0}

Boshqa hech narsa yozma.
`
        },

        {
          role: "user",

          content:
            JSON.stringify(
              simplified,
              null,
              2
            )
        }
      ],

      temperature:
        0.1,

      max_tokens:
        50
    });

  const content =
    completion
      ?.choices?.[0]
      ?.message
      ?.content
      ?.trim();

  console.log(
    "AI SELECTION:",
    content
  );

  try {
    const cleaned =
      content
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const parsed =
      JSON.parse(cleaned);

    if (
      Number.isInteger(
        parsed.index
      ) &&
      articles[parsed.index]
    ) {
      return articles[
        parsed.index
      ];
    }
  } catch (error) {
    console.error(
      "AI JSON ERROR:",
      error.message
    );
  }

  /*
    AI xato qilsa,
    birinchi maqolani olamiz.
  */

  return articles[0];
}

/* =========================================================
   GENERATE TELEGRAM POST
========================================================= */

async function generatePost(
  article
) {
  const completion =
    await groq.chat.completions.create({
      model:
        "openai/gpt-oss-20b",

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
tayyorgarlik platformasi.

POST QOIDALARI:

- Faqat rasmiy maqoladagi faktlardan foydalan.
- Hech qanday fakt o'ylab topma.
- Sana va raqamlarni o'zgartirma.
- Maqolaning asosiy mazmunini tushun.
- Bitta asosiy mavzuni tanla.
- Qisqa va tabiiy yoz.
- O'zbek tilida yoz.
- Telegram uchun qulay formatdan foydalan.
- Emoji me'yorida bo'lsin.
- Clickbait ishlatma.
- Rasmiy ohangni saqla, lekin zerikarli yozma.
- Eng muhim ma'lumotni boshida ber.

Post juda uzun bo'lmasin.

Oxirida foydalanuvchini
ALKHARAZMIY saytiga tabiiy ravishda
yo'naltirish mumkin:

${ALKHARAZMIY_URL}

Lekin saytni majburan reklama qilma.

FAQAT POST MATNINI QAYTAR.
`
        },

        {
          role: "user",

          content: `
RASMIY MANBA:
${article.url}

SANA:
${article.date || "Noma'lum"}

SARLAVHA:
${article.title}

MAQOLA:
${article.text}

Shu rasmiy maqolaga asoslanib
ALKHARAZMIY Telegram kanali uchun
qisqa, foydali va qiziqarli post yoz.
`
        }
      ],

      temperature:
        0.65,

      max_tokens:
        700
    });

  const post =
    completion
      ?.choices?.[0]
      ?.message
      ?.content
      ?.trim();

  if (!post) {
    throw new Error(
      "AI post generation returned empty result"
    );
  }

  return post;
}

/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegram(
  post,
  image
) {
  const base =
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

  /*
    1. RASM BILAN YUBORISH
  */

  if (image) {
    console.log(
      "TRY SEND PHOTO:",
      image
    );

    try {
      const response =
        await fetch(
          `${base}/sendPhoto`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              chat_id:
                CHANNEL_ID,

              photo:
                image,

              caption:
                post
            })
          }
        );

      const data =
        await response.json();

      if (data.ok) {
        console.log(
          "TELEGRAM PHOTO SENT"
        );

        return data;
      }

      console.error(
        "sendPhoto FAILED:",
        data
      );

    } catch (error) {
      console.error(
        "sendPhoto REQUEST ERROR:",
        error.message
      );
    }
  }

  /*
    2. RASM ISHLAMASA,
       TEXT YUBORAMIZ
  */

  console.log(
    "SENDING TEXT MESSAGE..."
  );

  const response =
    await fetch(
      `${base}/sendMessage`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          chat_id:
            CHANNEL_ID,

          text:
            post,

          disable_web_page_preview:
            false
        })
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      "Telegram sendMessage error"
    );
  }

  console.log(
    "TELEGRAM TEXT SENT"
  );

  return data;
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  try {
    console.log(
      "===================================="
    );

    console.log(
      "ALKHARAZMIY TELEGRAM CRON START"
    );

    console.log(
      new Date().toISOString()
    );

    console.log(
      "===================================="
    );

    /*
      ENV
    */

    validateEnv();

    /*
      CRON SECURITY
    */

    const auth =
      req.headers.authorization;

    if (
      process.env.CRON_SECRET &&
      auth !==
        `Bearer ${process.env.CRON_SECRET}`
    ) {
      console.error(
        "UNAUTHORIZED CRON REQUEST"
      );

      return res.status(401).json({
        success: false,
        error:
          "Unauthorized"
      });
    }

    /*
      1. NEW ARTICLES
    */

    const articles =
      await getNewArticles();

    /*
      2. NOTHING NEW
    */

    if (!articles.length) {
      console.log(
        "NO NEW ARTICLES."
      );

      return res.status(200).json({
        success: true,

        message:
          "Yangi rasmiy yangilik topilmadi. Post yuborilmadi.",

        checked:
          true,

        articles_found:
          0
      });
    }

    /*
      3. AI SELECT
    */

    const selected =
      await chooseNews(
        articles
      );

    if (!selected) {
      throw new Error(
        "No article selected"
      );
    }

    console.log(
      "SELECTED:",
      selected.title
    );

    /*
      4. GENERATE POST
    */

    const post =
      await generatePost(
        selected
      );

    console.log(
      "GENERATED POST:"
    );

    console.log(
      post
    );

    /*
      5. TELEGRAM
    */

    const telegramResult =
      await sendTelegram(
        post,
        selected.image
      );

    /*
      6. SAVE ONLY AFTER
         SUCCESSFUL TELEGRAM SEND
    */

    await savePost(
      selected
    );

    /*
      7. SUCCESS
    */

    console.log(
      "===================================="
    );

    console.log(
      "CRON SUCCESS"
    );

    console.log(
      "===========================
